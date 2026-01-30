import * as hcloud from '@pulumi/hcloud';
import { ComponentResource, ComponentResourceOptions, Output, getProject, getStack } from '@pulumi/pulumi';

export interface NetworkArgs {
    ipRange?: string;
    networkZone?: string;
}

export class Network extends ComponentResource {
    public readonly id: Output<number>;
    public readonly network: hcloud.Network;
    public readonly subnet: hcloud.NetworkSubnet;

    constructor(name: string, args: NetworkArgs = {}, opts?: ComponentResourceOptions) {
        super('infra:hcloud:Network', name, {}, opts);

        const ipRange = args.ipRange ?? '10.0.0.0/16';
        const networkZone = args.networkZone ?? 'eu-central';

        this.network = new hcloud.Network(
            name,
            {
                ipRange,
                labels: {
                    project: getProject(),
                    env: getStack(),
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        this.subnet = new hcloud.NetworkSubnet(
            `${name}-subnet`,
            {
                networkId: this.network.id.apply(Number),
                type: 'cloud',
                networkZone,
                ipRange: '10.0.0.0/24',
            },
            { parent: this },
        );

        this.id = this.network.id.apply(Number);

        this.registerOutputs({
            id: this.id,
        });
    }
}
