import { Output } from '@pulumi/pulumi';

export type NodeRole = 'controlplane' | 'worker';

export interface NodeSpec {
    location: string;
    name: string;
    type: string;
}

export interface TailscaleConfig {
    authKey: Output<string>;
    tailnet: string;
}

export interface BastionConfig {
    location?: string;
    serverType?: string;
}

export interface ClusterConfig {
    allowInitialProvisioning: boolean;
    bastion?: BastionConfig;
    controlPlanes: NodeSpec[];
    deployCluster: boolean;
    kubernetesVersion: string;
    name: string;
    snapshotId: string;
    tailscale: TailscaleConfig;
    talosVersion: string;
    workers: NodeSpec[];
}
