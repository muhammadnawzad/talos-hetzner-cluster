import * as hcloud from '@pulumi/hcloud';
import { ComponentResource, ComponentResourceOptions, Input, Output, getProject, getStack } from '@pulumi/pulumi';
import { NodeRole } from '../types';

export interface FirewallArgs {
    allowInitialProvisioning?: boolean;
    floatingIp: Input<string>;
    podCidr?: string;
    privateNetworkCidr?: string;
    role: NodeRole;
}

interface FirewallRule {
    description?: string;
    destinationIps?: string[];
    direction: 'in' | 'out';
    port?: string;
    protocol: 'tcp' | 'udp' | 'icmp' | 'gre' | 'esp';
    sourceIps?: string[];
}

function buildRules(args: FirewallArgs, floatingIpCidr: string): FirewallRule[] {
    const privateNet = args.privateNetworkCidr ?? '10.0.0.0/16';
    const podCidr = args.podCidr ?? '10.244.0.0/16';
    const protectedSources = args.allowInitialProvisioning ? ['0.0.0.0/0', '::/0'] : [floatingIpCidr, privateNet];
    const apiSources = args.allowInitialProvisioning ? ['0.0.0.0/0', '::/0'] : [floatingIpCidr, privateNet, podCidr];

    const common: FirewallRule[] = [
        {
            direction: 'in',
            protocol: 'icmp',
            sourceIps: ['0.0.0.0/0', '::/0'],
            description: 'ICMP',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '50000',
            sourceIps: protectedSources,
            description: args.allowInitialProvisioning ? 'Talos API (initial provisioning)' : 'Talos API (protected)',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '50001',
            sourceIps: [privateNet],
            description: 'Talos inter-node',
        },
        {
            direction: 'in',
            protocol: 'udp',
            port: '51820',
            sourceIps: [privateNet],
            description: 'KubeSpan WireGuard',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '10250',
            sourceIps: [privateNet],
            description: 'Kubelet',
        },
    ];

    const controlPlaneRules: FirewallRule[] = [
        {
            direction: 'in',
            protocol: 'tcp',
            port: '6443',
            sourceIps: apiSources,
            description: args.allowInitialProvisioning ? 'Kubernetes API (initial provisioning)' : 'Kubernetes API (protected)',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '2379-2380',
            sourceIps: [privateNet],
            description: 'etcd',
        },
    ];

    const workerRules: FirewallRule[] = [
        {
            direction: 'in',
            protocol: 'tcp',
            port: '80',
            sourceIps: ['0.0.0.0/0', '::/0'],
            description: 'HTTP',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '443',
            sourceIps: ['0.0.0.0/0', '::/0'],
            description: 'HTTPS',
        },
        {
            direction: 'in',
            protocol: 'tcp',
            port: '30000-32767',
            sourceIps: [privateNet],
            description: 'NodePorts',
        },
    ];

    return args.role === 'controlplane' ? [...common, ...controlPlaneRules] : [...common, ...workerRules];
}

export class Firewall extends ComponentResource {
    public readonly id: Output<number>;

    constructor(name: string, args: FirewallArgs, opts?: ComponentResourceOptions) {
        super('infra:hcloud:Firewall', name, {}, opts);

        const floatingIpCidr = Output.create(args.floatingIp).apply(ip => `${ip}/32`);

        const firewall = new hcloud.Firewall(
            name,
            {
                rules: floatingIpCidr.apply(cidr => buildRules(args, cidr)),
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: args.role,
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        this.id = firewall.id.apply(Number);

        this.registerOutputs({
            id: this.id,
        });
    }
}
