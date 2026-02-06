import { Cilium } from './cilium';
import { ComponentResource, ComponentResourceOptions, Input, Output } from '@pulumi/pulumi';
import { ControlPlaneLB } from './control-plane-lb';
import { Provider } from '@pulumi/kubernetes/provider';
import { Release } from '@pulumi/kubernetes/helm/v3';
import { Secret } from '@pulumi/kubernetes/core/v1';
import { secret, interpolate } from '@pulumi/pulumi';

export interface HetznerCoreArgs {
    ciliumVersion?: string;
    clusterCidr?: string;
    controlPlanePrivateIps: Output<string>[];
    defaultVolumeLocation?: string;
    hcloudToken: Input<string>;
    kubeconfig: Input<string>;
    networkId: Input<number>;
}

export class HetznerCore extends ComponentResource {
    public readonly ccmRelease: Release;
    public readonly cilium: Cilium;
    public readonly controlPlaneLB: ControlPlaneLB;
    public readonly csiRelease: Release;
    public readonly metricsServerRelease: Release;

    constructor(name: string, args: HetznerCoreArgs, opts?: ComponentResourceOptions) {
        super('infra:hetzner:Core', name, {}, opts);

        const clusterCidr = args.clusterCidr ?? '10.244.0.0/16';
        const defaultVolumeLocation = args.defaultVolumeLocation ?? 'fsn1';
        const ciliumVersion = args.ciliumVersion ?? '1.18.6';

        const k8sProvider = new Provider(
            `${name}-k8s`,
            {
                kubeconfig: args.kubeconfig,
            },
            { parent: this },
        );

        this.cilium = new Cilium(
            `${name}-cilium`,
            {
                k8sProvider,
                version: ciliumVersion,
                gatewayApiEnabled: false,
                l2AnnouncementsEnabled: true,
                podCidr: clusterCidr,
            },
            { parent: this },
        );

        const namespace = 'kube-system';

        const hcloudSecret = new Secret(
            `${name}-hcloud-secret`,
            {
                metadata: {
                    name: 'hcloud',
                    namespace,
                },
                stringData: {
                    token: secret(args.hcloudToken),
                    network: interpolate`${args.networkId}`,
                },
            },
            { parent: this, provider: k8sProvider },
        );

        this.ccmRelease = new Release(
            `${name}-ccm`,
            {
                name: 'hccm',
                namespace,
                chart: 'hcloud-cloud-controller-manager',
                repositoryOpts: {
                    repo: 'https://charts.hetzner.cloud',
                },
                version: '1.29.2',
                values: {
                    networking: {
                        enabled: true,
                        clusterCIDR: clusterCidr,
                        network: {
                            valueFrom: {
                                secretKeyRef: {
                                    name: 'hcloud',
                                    key: 'network',
                                },
                            },
                        },
                    },
                    env: {
                        HCLOUD_TOKEN: {
                            valueFrom: {
                                secretKeyRef: {
                                    name: 'hcloud',
                                    key: 'token',
                                },
                            },
                        },
                    },
                    monitoring: {
                        enabled: true,
                    },
                    additionalTolerations: [
                        {
                            key: 'node-role.kubernetes.io/control-plane',
                            effect: 'NoSchedule',
                        },
                        {
                            key: 'node.cloudprovider.kubernetes.io/uninitialized',
                            value: 'true',
                            effect: 'NoSchedule',
                        },
                    ],
                    hostNetwork: true,
                },
            },
            { parent: this, provider: k8sProvider, dependsOn: [hcloudSecret] },
        );

        this.csiRelease = new Release(
            `${name}-csi`,
            {
                name: 'hcloud-csi',
                namespace,
                chart: 'hcloud-csi',
                repositoryOpts: {
                    repo: 'https://charts.hetzner.cloud',
                },
                version: '2.18.3',
                values: {
                    controller: {
                        hcloudToken: {
                            existingSecret: {
                                name: 'hcloud',
                                key: 'token',
                            },
                        },
                        hcloudVolumeDefaultLocation: defaultVolumeLocation,
                    },
                    node: {
                        affinity: {
                            nodeAffinity: {
                                requiredDuringSchedulingIgnoredDuringExecution: {
                                    nodeSelectorTerms: [
                                        {
                                            matchExpressions: [
                                                {
                                                    key: 'instance.hetzner.cloud/is-root-server',
                                                    operator: 'NotIn',
                                                    values: ['true'],
                                                },
                                                {
                                                    key: 'instance.hetzner.cloud/provided-by',
                                                    operator: 'NotIn',
                                                    values: ['robot'],
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                    metrics: {
                        enabled: true,
                    },
                    storageClasses: [
                        {
                            name: 'hcloud-volumes',
                            defaultStorageClass: true,
                            reclaimPolicy: 'Delete',
                        },
                    ],
                },
            },
            { parent: this, provider: k8sProvider, dependsOn: [hcloudSecret, this.cilium] },
        );

        this.metricsServerRelease = new Release(
            `${name}-metrics-server`,
            {
                name: 'metrics-server',
                namespace,
                chart: 'metrics-server',
                repositoryOpts: {
                    repo: 'https://kubernetes-sigs.github.io/metrics-server/',
                },
                version: '3.12.2',
                values: {
                    args: ['--kubelet-insecure-tls'],
                    tolerations: [
                        {
                            key: 'node-role.kubernetes.io/control-plane',
                            effect: 'NoSchedule',
                        },
                    ],
                },
            },
            { parent: this, provider: k8sProvider, dependsOn: [this.cilium] },
        );

        this.controlPlaneLB = new ControlPlaneLB(
            `${name}-cp-lb`,
            {
                k8sProvider,
                controlPlaneIps: args.controlPlanePrivateIps,
            },
            { parent: this, dependsOn: [this.cilium] },
        );

        this.registerOutputs({
            cilium: this.cilium,
            ccmRelease: this.ccmRelease,
            csiRelease: this.csiRelease,
            metricsServerRelease: this.metricsServerRelease,
            controlPlaneLB: this.controlPlaneLB,
        });
    }
}
