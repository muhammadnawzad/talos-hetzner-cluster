import { ComponentResource, ComponentResourceOptions, Output } from '@pulumi/pulumi';
import * as talos from '@pulumiverse/talos';
import { NodeRole } from '../types';

export interface TalosSecretsArgs {
    clusterEndpoint: string;
    clusterName: string;
    talosVersion: string;
}

export class TalosSecrets extends ComponentResource {
    public readonly secrets: talos.machine.Secrets;
    public readonly clientConfig: Output<talos.client.GetConfigurationResult>;

    constructor(name: string, args: TalosSecretsArgs, opts?: ComponentResourceOptions) {
        super('infra:talos:Secrets', name, {}, opts);

        this.secrets = new talos.machine.Secrets(name, { talosVersion: args.talosVersion }, { parent: this });

        this.clientConfig = talos.client.getConfigurationOutput({
            clusterName: args.clusterName,
            clientConfiguration: this.secrets.clientConfiguration,
            endpoints: [args.clusterEndpoint],
        });

        this.registerOutputs({
            secrets: this.secrets,
            clientConfig: this.clientConfig,
        });
    }
}

export interface MachineConfigArgs {
    certSANs?: string[];
    clusterEndpoint: string;
    clusterName: string;
    kubernetesVersion: string;
    role: NodeRole;
    secrets: talos.machine.Secrets;
    talosVersion: string;
}

function getCommonPatch(): object {
    return {
        machine: {
            network: {
                kubespan: { enabled: true },
            },
            nodeLabels: {
                'kubernetes.io/os': 'linux',
            },
            kubelet: {
                registerWithFQDN: true,
                extraArgs: {
                    'rotate-server-certificates': 'true',
                    'cloud-provider': 'external',
                },
                extraMounts: [
                    {
                        destination: '/var/local',
                        type: 'bind',
                        source: '/var/local',
                        options: ['bind', 'rshared', 'rw'],
                    },
                    {
                        destination: '/sys/fs/bpf',
                        type: 'bind',
                        source: '/sys/fs/bpf',
                        options: ['bind', 'rshared', 'rw'],
                    },
                ],
            },
            sysctls: {
                'vm.nr_hugepages': '1024',
                'vm.max_map_count': '262144',
                'vm.overcommit_memory': '1',
                'vm.swappiness': '1',
                'net.core.bpf_jit_enable': '1',
                'net.ipv4.conf.all.rp_filter': '0',
                'net.ipv4.conf.default.rp_filter': '0',
            },
        },
        cluster: {
            network: {
                cni: {
                    name: 'none',
                },
            },
            proxy: {
                disabled: true,
            },
        },
    };
}

function getControlPlanePatch(certSANs?: string[]): object {
    return {
        machine: {
            certSANs: certSANs ?? [],
            nodeLabels: {
                'node-role.kubernetes.io/control-plane': 'true',
                'node-role.kubernetes.io/etcd': 'true',
                'node-role.kubernetes.io/master': 'true',
            },
        },
        cluster: {
            discovery: {
                enabled: true,
                registries: {
                    kubernetes: { disabled: true },
                    service: {},
                },
            },
            extraManifests: ['https://raw.githubusercontent.com/alex1989hu/kubelet-serving-cert-approver/main/deploy/standalone-install.yaml'],
            controllerManager: {
                extraArgs: { 'bind-address': '0.0.0.0' },
            },
            scheduler: {
                extraArgs: { 'bind-address': '0.0.0.0' },
            },
            apiServer: {
                certSANs: certSANs ?? [],
            },
        },
    };
}

export function generateMachineConfig(args: MachineConfigArgs): Output<string> {
    const patches = [JSON.stringify(getCommonPatch())];
    if (args.role === 'controlplane') {
        patches.push(JSON.stringify(getControlPlanePatch(args.certSANs)));
    }

    const config = talos.machine.getConfigurationOutput({
        clusterName: args.clusterName,
        machineType: args.role,
        clusterEndpoint: args.clusterEndpoint,
        machineSecrets: args.secrets.machineSecrets,
        talosVersion: args.talosVersion,
        kubernetesVersion: args.kubernetesVersion,
        configPatches: patches,
        docs: false,
        examples: false,
    });

    return config.machineConfiguration;
}

export function generateTailscalePatch(nodeName: string, authKey: string): string {
    return `apiVersion: v1alpha1
kind: ExtensionServiceConfig
name: tailscale
environment:
  - TS_AUTHKEY=${authKey}
  - TS_HOSTNAME=${nodeName}
  - TS_AUTH_ONCE=true`;
}
