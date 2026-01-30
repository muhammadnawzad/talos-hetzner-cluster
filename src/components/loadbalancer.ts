import * as hcloud from '@pulumi/hcloud';
import { ComponentResource, ComponentResourceOptions, Output, getProject, getStack } from '@pulumi/pulumi';
import { NodeRole } from '../types';

export interface LoadBalancerArgs {
    role: NodeRole;
    location: string;
    ports: number[];
    algorithm?: 'round_robin' | 'least_connections';
    type?: string;
}

export class LoadBalancer extends ComponentResource {
    public readonly ipv4: Output<string>;

    constructor(name: string, args: LoadBalancerArgs, opts?: ComponentResourceOptions) {
        super('infra:hcloud:LoadBalancer', name, {}, opts);

        const lb = new hcloud.LoadBalancer(
            name,
            {
                loadBalancerType: args.type ?? 'lb11',
                location: args.location,
                algorithm: { type: args.algorithm ?? 'least_connections' },
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: args.role,
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        for (const port of args.ports) {
            new hcloud.LoadBalancerService(
                `${name}-${port}`,
                {
                    loadBalancerId: lb.id,
                    protocol: 'tcp',
                    listenPort: port,
                    destinationPort: port,
                },
                { parent: this },
            );
        }

        new hcloud.LoadBalancerTarget(
            `${name}-target`,
            {
                loadBalancerId: lb.id.apply(Number),
                type: 'label_selector',
                labelSelector: `project=${getProject()},env=${getStack()},role=${args.role}`,
            },
            { parent: this },
        );

        this.ipv4 = lb.ipv4;

        this.registerOutputs({
            ipv4: this.ipv4,
        });
    }
}
