import * as hcloud from '@pulumi/hcloud';
import { ComponentResource, ComponentResourceOptions, Input, Output, getProject, getStack, output } from '@pulumi/pulumi';
import { NodeRole } from '../types';

export interface ServerArgs {
    firewallId?: Input<number>;
    location: Input<string>;
    networkId?: Input<number>;
    role: NodeRole;
    serverType: Input<string>;
    snapshotId: Input<string>;
}

export class Server extends ComponentResource {
    public readonly id: Output<number>;
    public readonly ipv4: Output<string>;
    public readonly privateIpv4: Output<string>;

    constructor(name: string, args: ServerArgs, opts?: ComponentResourceOptions) {
        super('infra:hcloud:Server', name, {}, opts);

        const server = new hcloud.Server(
            name,
            {
                image: args.snapshotId,
                serverType: args.serverType,
                location: args.location,
                firewallIds: args.firewallId !== undefined ? [args.firewallId] : undefined,
                publicNets: [{ ipv4Enabled: true, ipv6Enabled: false }],
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: args.role,
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        let privateIp: Output<string>;
        if (args.networkId !== undefined) {
            const serverNetwork = new hcloud.ServerNetwork(
                `${name}-net`,
                {
                    serverId: server.id.apply(Number),
                    networkId: args.networkId,
                },
                { parent: this, dependsOn: [server] },
            );
            privateIp = serverNetwork.ip;
        } else {
            privateIp = output('');
        }

        this.id = server.id.apply(Number);
        this.ipv4 = server.ipv4Address;
        this.privateIpv4 = privateIp;

        this.registerOutputs({
            id: this.id,
            ipv4: this.ipv4,
            privateIpv4: this.privateIpv4,
        });
    }
}
