import { Config } from '@pulumi/pulumi';
import { BastionConfig, ClusterConfig, NodeSpec } from './types';

const cfg = new Config('configurations');
const tailscale = new Config('tailscale');
const bastion = new Config('bastion');

const bastionConfig: BastionConfig | undefined =
    bastion.get('location') || bastion.get('serverType')
        ? {
              location: bastion.get('location') ?? 'fsn1',
              serverType: bastion.get('serverType') ?? 'cx23',
          }
        : {
              location: 'fsn1',
              serverType: 'cx23',
          };

export const config: ClusterConfig = {
    name: cfg.require('clusterName'),
    snapshotId: cfg.require('snapshotId'),
    talosVersion: cfg.get('talosVersion') ?? 'v1.12.2',
    kubernetesVersion: cfg.get('kubernetesVersion') ?? 'v1.35.0',
    controlPlanes: cfg.requireObject<NodeSpec[]>('controlPlanes'),
    workers: cfg.requireObject<NodeSpec[]>('workerNodes'),
    tailscale: {
        authKey: tailscale.requireSecret('authKey'),
        tailnet: tailscale.require('tailnet'),
    },
    bastion: bastionConfig,
    deployCluster: cfg.getBoolean('deployCluster') ?? true,
    allowInitialProvisioning: cfg.getBoolean('allowInitialProvisioning') ?? true,
};
