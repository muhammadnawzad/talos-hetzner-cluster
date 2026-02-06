import { ComponentResource, ComponentResourceOptions, Input, Output, Resource } from '@pulumi/pulumi';
import { Kubeconfig } from '@pulumiverse/talos/cluster';
import { Bootstrap, ConfigurationApply, Secrets } from '@pulumiverse/talos/machine';
import { ClusterConfig, NodeSpec } from '../types';
import { Firewall } from './firewall';
import { Network } from './network';
import { Server } from './server';
import { TalosSecrets, generateMachineConfig, generateTailscalePatch } from './talos';

export interface TalosClusterArgs {
    config: ClusterConfig;
    floatingIp: Input<string>;
}

interface NodeOutput {
    name: string;
    privateIp: Output<string>;
    providerId: Output<string>;
    publicIp: Output<string>;
    tailscaleHostname: string;
}

function getTailscaleHostname(nodeName: string, clusterName: string, tailnet: string): string {
    return `${nodeName}-${clusterName}.${tailnet}`;
}

export class TalosCluster extends ComponentResource {
    public readonly certSANs: string[];
    public readonly clusterEndpoint: string;
    public readonly controlPlaneNodes: NodeOutput[];
    public readonly kubeconfig: Output<string>;
    public readonly networkId: Output<number>;
    public readonly talosConfig: Output<string>;
    public readonly workerNodes: NodeOutput[];

    constructor(name: string, args: TalosClusterArgs, opts?: ComponentResourceOptions) {
        super('infra:cluster:TalosCluster', name, {}, opts);

        const cfg = args.config;

        const network = new Network(`${name}-network`, {}, { parent: this });

        const cpFirewall = new Firewall(
            `${name}-cp-fw`,
            {
                role: 'controlplane',
                floatingIp: args.floatingIp,
                allowInitialProvisioning: cfg.allowInitialProvisioning,
            },
            { parent: this },
        );

        const workerFirewall = new Firewall(
            `${name}-worker-fw`,
            {
                role: 'worker',
                floatingIp: args.floatingIp,
                allowInitialProvisioning: cfg.allowInitialProvisioning,
            },
            { parent: this },
        );

        const cpServers = this.createServers(name, cfg.controlPlanes, 'controlplane', cfg.snapshotId, cpFirewall.id, network.id, [network]);
        const cpTailscaleHostnames = cfg.controlPlanes.map(spec => getTailscaleHostname(spec.name, cfg.name, cfg.tailscale.tailnet));

        const primaryEndpoint = cpTailscaleHostnames[0];
        const clusterEndpoint = `https://${primaryEndpoint}:6443`;
        const certSANs = cpTailscaleHostnames;

        const talosSecrets = new TalosSecrets(
            `${name}-secrets`,
            {
                clusterName: cfg.name,
                clusterEndpoint,
                talosVersion: cfg.talosVersion,
            },
            { parent: this },
        );

        const cpConfigApplies = this.applyConfigs(name, cfg, cpServers, cfg.controlPlanes, 'controlplane', clusterEndpoint, talosSecrets.secrets, certSANs, []);

        const bootstrap = new Bootstrap(
            `${name}-bootstrap`,
            {
                clientConfiguration: talosSecrets.secrets.clientConfiguration,
                node: cpServers[0].ipv4,
                endpoint: cpServers[0].ipv4,
            },
            { parent: this, dependsOn: cpConfigApplies },
        );

        const workerServers = this.createServers(name, cfg.workers, 'worker', cfg.snapshotId, workerFirewall.id, network.id, [network, bootstrap]);

        const workerTailscaleHostnames = cfg.workers.map(spec => getTailscaleHostname(spec.name, cfg.name, cfg.tailscale.tailnet));

        this.applyConfigs(name, cfg, workerServers, cfg.workers, 'worker', clusterEndpoint, talosSecrets.secrets, undefined, [bootstrap]);

        const kubeconfig = new Kubeconfig(
            `${name}-kubeconfig`,
            {
                node: cpServers[0].ipv4,
                clientConfiguration: talosSecrets.secrets.clientConfiguration,
            },
            { parent: this, dependsOn: [bootstrap] },
        );

        this.controlPlaneNodes = cpServers.map((s, i) => ({
            name: cfg.controlPlanes[i].name,
            publicIp: s.ipv4,
            privateIp: s.privateIpv4,
            providerId: s.id.apply(id => `hcloud://${id}`),
            tailscaleHostname: cpTailscaleHostnames[i],
        }));

        this.workerNodes = workerServers.map((s, i) => ({
            name: cfg.workers[i].name,
            publicIp: s.ipv4,
            privateIp: s.privateIpv4,
            providerId: s.id.apply(id => `hcloud://${id}`),
            tailscaleHostname: workerTailscaleHostnames[i],
        }));

        this.kubeconfig = kubeconfig.kubeconfigRaw;
        this.talosConfig = talosSecrets.clientConfig.apply(c => c.talosConfig);
        this.networkId = network.id;
        this.clusterEndpoint = clusterEndpoint;
        this.certSANs = certSANs;

        this.registerOutputs({
            controlPlaneNodes: this.controlPlaneNodes,
            workerNodes: this.workerNodes,
            kubeconfig: this.kubeconfig,
            talosConfig: this.talosConfig,
            networkId: this.networkId,
            clusterEndpoint: this.clusterEndpoint,
            certSANs: this.certSANs,
        });
    }

    private createServers(
        baseName: string,
        specs: NodeSpec[],
        role: 'controlplane' | 'worker',
        snapshotId: string,
        firewallId: Output<number>,
        networkId: Output<number>,
        dependsOn: Resource[],
    ): Server[] {
        return specs.map(
            spec =>
                new Server(
                    `${baseName}-${spec.name}`,
                    {
                        role,
                        snapshotId,
                        serverType: spec.type,
                        location: spec.location,
                        firewallId,
                        networkId,
                    },
                    { parent: this, dependsOn },
                ),
        );
    }

    private applyConfigs(
        baseName: string,
        cfg: ClusterConfig,
        servers: Server[],
        specs: NodeSpec[],
        role: 'controlplane' | 'worker',
        clusterEndpoint: string,
        secrets: Secrets,
        certSANs: string[] | undefined,
        extraDeps: Resource[] = [],
    ): ConfigurationApply[] {
        return servers.map((server, i) => {
            const tailscaleNodeName = `${specs[i].name}-${cfg.name}`;

            const machineConfig = generateMachineConfig({
                clusterName: cfg.name,
                clusterEndpoint,
                talosVersion: cfg.talosVersion,
                kubernetesVersion: cfg.kubernetesVersion,
                role,
                secrets,
                certSANs,
            });

            const tailscalePatch = cfg.tailscale.authKey.apply(key => generateTailscalePatch(tailscaleNodeName, key));

            return new ConfigurationApply(
                `${baseName}-${specs[i].name}-config`,
                {
                    clientConfiguration: secrets.clientConfiguration,
                    machineConfigurationInput: machineConfig,
                    node: server.ipv4,
                    endpoint: server.ipv4,
                    configPatches: [tailscalePatch],
                },
                { parent: this, dependsOn: [server, ...extraDeps] },
            );
        });
    }
}
