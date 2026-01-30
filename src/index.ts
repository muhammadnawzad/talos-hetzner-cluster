import { Config } from '@pulumi/pulumi';
import { Bastion } from './components/bastion';
import { TalosCluster } from './components/cluster';
import { HetznerCore } from './components/hetzner-core';
import { config } from './config';

const hcloudConfig = new Config('hcloud');

const bastion = new Bastion(`${config.name}-bastion`, {
    tailscaleAuthKey: config.tailscale.authKey,
    tailscaleHostname: `bastion-${config.name}`,
    location: config.bastion?.location ?? 'fsn1',
    serverType: config.bastion?.serverType ?? 'cx23',
});

export const bastionFloatingIp = bastion.floatingIpAddress;
export const bastionPublicIp = bastion.publicIp;
export const bastionTailscaleHostname = `bastion-${config.name}`;
export const deployCluster = config.deployCluster;

if (config.deployCluster) {
    const cluster = new TalosCluster(config.name, {
        config,
        floatingIp: bastion.floatingIpAddress,
    });

    const hetznerCore = new HetznerCore(
        `${config.name}-hetzner-core`,
        {
            kubeconfig: cluster.kubeconfig,
            hcloudToken: hcloudConfig.requireSecret('token'),
            networkId: cluster.networkId,
            controlPlanePrivateIps: cluster.controlPlaneNodes.map(node => node.privateIp),
            clusterCidr: '10.244.0.0/16',
            defaultVolumeLocation: 'fsn1',
        },
        { dependsOn: [cluster] },
    );

    exports.controlPlaneNodes = cluster.controlPlaneNodes;
    exports.workerNodes = cluster.workerNodes;
    exports.workerLoadBalancerIp = cluster.workerLoadBalancerIp;

    exports.kubeconfig = cluster.kubeconfig;
    exports.talosConfig = cluster.talosConfig;
    exports.clusterEndpoint = cluster.clusterEndpoint;
    exports.certSANs = cluster.certSANs;

    exports.networkId = cluster.networkId;
    exports.ciliumRelease = hetznerCore.cilium.release.status;
    exports.ccmRelease = hetznerCore.ccmRelease.status;
    exports.csiRelease = hetznerCore.csiRelease.status;
    exports.metricsServerRelease = hetznerCore.metricsServerRelease.status;
    exports.controlPlaneLBClusterIp = hetznerCore.controlPlaneLB.clusterIp;
}
