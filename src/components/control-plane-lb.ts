import { Endpoints, Service } from '@pulumi/kubernetes/core/v1';
import { Provider } from '@pulumi/kubernetes/provider';
import { ComponentResource, ComponentResourceOptions, Output } from '@pulumi/pulumi';

export interface ControlPlaneLBArgs {
    controlPlaneIps: Output<string>[];
    k8sProvider: Provider;
    namespace?: string;
}

export class ControlPlaneLB extends ComponentResource {
    public readonly clusterIp: Output<string>;
    public readonly service: Service;

    constructor(name: string, args: ControlPlaneLBArgs, opts?: ComponentResourceOptions) {
        super('infra:k8s:ControlPlaneLB', name, {}, opts);
        const namespace = args.namespace ?? 'kube-system';

        const endpoints = new Endpoints(
            `${name}-endpoints`,
            {
                metadata: {
                    name: `${name}-api`,
                    namespace,
                    labels: {
                        'app.kubernetes.io/name': 'control-plane-lb',
                        'app.kubernetes.io/component': 'api-server',
                    },
                },
                subsets: [
                    {
                        addresses: args.controlPlaneIps.map(ip => ({
                            ip,
                        })),
                        ports: [
                            {
                                name: 'https',
                                port: 6443,
                                protocol: 'TCP',
                            },
                        ],
                    },
                ],
            },
            { parent: this, provider: args.k8sProvider },
        );

        this.service = new Service(
            `${name}-service`,
            {
                metadata: {
                    name: `${name}-api`,
                    namespace,
                    labels: {
                        'app.kubernetes.io/name': 'control-plane-lb',
                        'app.kubernetes.io/component': 'api-server',
                    },
                },
                spec: {
                    type: 'ClusterIP',
                    ports: [
                        {
                            name: 'https',
                            port: 6443,
                            targetPort: 6443,
                            protocol: 'TCP',
                        },
                    ],
                },
            },
            { parent: this, provider: args.k8sProvider, dependsOn: [endpoints] },
        );

        this.clusterIp = this.service.spec.clusterIP;

        this.registerOutputs({
            service: this.service,
            clusterIp: this.clusterIp,
        });
    }
}
