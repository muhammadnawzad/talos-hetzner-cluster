import { Provider } from '@pulumi/kubernetes';
import { Release } from '@pulumi/kubernetes/helm/v3';
import { ComponentResource, ComponentResourceOptions } from '@pulumi/pulumi';

export interface CiliumArgs {
    gatewayApiEnabled?: boolean;
    k8sProvider: Provider;
    l2AnnouncementsEnabled?: boolean;
    podCidr?: string;
    version?: string;
}

export class Cilium extends ComponentResource {
    public readonly release: Release;

    constructor(name: string, args: CiliumArgs, opts?: ComponentResourceOptions) {
        super('infra:k8s:Cilium', name, {}, opts);

        const version = args.version ?? '1.18.6';
        const gatewayApiEnabled = args.gatewayApiEnabled ?? true;
        const l2AnnouncementsEnabled = args.l2AnnouncementsEnabled ?? true;
        void (args.podCidr ?? '10.244.0.0/16');

        const ciliumValues = {
            ipam: {
                mode: 'kubernetes',
            },
            kubeProxyReplacement: true,
            k8sServiceHost: 'localhost',
            k8sServicePort: 7445,
            securityContext: {
                capabilities: {
                    ciliumAgent: [
                        'CHOWN',
                        'KILL',
                        'NET_ADMIN',
                        'NET_RAW',
                        'IPC_LOCK',
                        'SYS_ADMIN',
                        'SYS_RESOURCE',
                        'DAC_OVERRIDE',
                        'FOWNER',
                        'SETGID',
                        'SETUID',
                    ],
                    cleanCiliumState: ['NET_ADMIN', 'SYS_ADMIN', 'SYS_RESOURCE'],
                },
            },
            cgroup: {
                autoMount: { enabled: false },
                hostRoot: '/sys/fs/cgroup',
            },
            gatewayAPI: {
                enabled: gatewayApiEnabled,
                enableAlpn: true,
                enableAppProtocol: true,
            },
            l2announcements: {
                enabled: l2AnnouncementsEnabled,
            },
            externalIPs: {
                enabled: true,
            },
            hubble: {
                enabled: true,
                tls: {
                    auto: {
                        enabled: true,
                        method: 'cronJob',
                        certValidityDuration: 1095, // 3 years
                        schedule: '0 0 1 */4 *', // Renew every 4 months
                    },
                },
                relay: {
                    enabled: true,
                },
                ui: {
                    enabled: true,
                },
            },
            operator: {
                replicas: 1,
            },
            routingMode: 'tunnel',
            tunnelProtocol: 'vxlan',
            bpf: {
                masquerade: true,
            },
        };

        this.release = new Release(
            name,
            {
                chart: 'cilium',
                version,
                namespace: 'kube-system',
                repositoryOpts: {
                    repo: 'https://helm.cilium.io/',
                },
                values: ciliumValues,
                waitForJobs: true,
                timeout: 600,
            },
            { parent: this, provider: args.k8sProvider },
        );

        this.registerOutputs({
            release: this.release,
        });
    }
}
