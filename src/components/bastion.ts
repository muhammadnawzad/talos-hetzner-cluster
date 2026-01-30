import { Firewall, FloatingIp, FloatingIpAssignment, Server, ServerNetwork } from '@pulumi/hcloud';
import { ComponentResource, ComponentResourceOptions, Input, Output, getProject, getStack } from '@pulumi/pulumi';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface BastionArgs {
    location?: string;
    networkId?: Input<number>;
    serverType?: string;
    tailscaleAuthKey: Input<string>;
    tailscaleHostname: string;
}

export class Bastion extends ComponentResource {
    public readonly floatingIp: FloatingIp;
    public readonly floatingIpAddress: Output<string>;
    public readonly privateIp: Output<string | undefined>;
    public readonly publicIp: Output<string>;
    public readonly server: Server;

    constructor(name: string, args: BastionArgs, opts?: ComponentResourceOptions) {
        super('infra:hcloud:Bastion', name, {}, opts);

        const location = args.location ?? 'fsn1';
        const serverType = args.serverType ?? 'cx23';

        const scriptPath = join(__dirname, '../../scripts/bastion-cloudinit.sh');
        const scriptTemplate = readFileSync(scriptPath, 'utf-8');

        const cloudInit = Output.create(args.tailscaleAuthKey).apply(authKey =>
            scriptTemplate.replace(/{{TAILSCALE_AUTH_KEY}}/g, authKey).replace(/{{TAILSCALE_HOSTNAME}}/g, args.tailscaleHostname),
        );

        const firewall = new Firewall(
            `${name}-fw`,
            {
                rules: [
                    {
                        direction: 'in',
                        protocol: 'icmp',
                        sourceIps: ['0.0.0.0/0', '::/0'],
                        description: 'ICMP (ping)',
                    },
                ],
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: 'bastion',
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        this.server = new Server(
            name,
            {
                image: 'ubuntu-24.04',
                serverType,
                location,
                userData: cloudInit,
                firewallIds: [firewall.id.apply(Number)],
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: 'bastion',
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        if (args.networkId !== undefined) {
            new ServerNetwork(
                `${name}-net`,
                {
                    serverId: this.server.id.apply(Number),
                    networkId: args.networkId,
                },
                { parent: this },
            );
        }

        this.floatingIp = new FloatingIp(
            `${name}-ip`,
            {
                type: 'ipv4',
                homeLocation: location,
                labels: {
                    project: getProject(),
                    env: getStack(),
                    role: 'bastion',
                    'managed-by': 'pulumi',
                },
            },
            { parent: this },
        );

        new FloatingIpAssignment(
            `${name}-ip-assign`,
            {
                floatingIpId: this.floatingIp.id.apply(Number),
                serverId: this.server.id.apply(Number),
            },
            { parent: this, dependsOn: [this.server, this.floatingIp] },
        );

        this.floatingIpAddress = this.floatingIp.ipAddress;
        this.publicIp = this.server.ipv4Address;
        this.privateIp = this.server.ipv4Address;

        this.registerOutputs({
            server: this.server,
            floatingIp: this.floatingIp,
            floatingIpAddress: this.floatingIpAddress,
            publicIp: this.publicIp,
        });
    }
}
