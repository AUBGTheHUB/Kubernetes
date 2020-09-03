"use strict";
const pulumi = require("@pulumi/pulumi");
const docker = require("@pulumi/docker");
const k8s = require("@pulumi/kubernetes");

const appLabels = { app: "unimorph" };

const config = new pulumi.Config();

const ns = new k8s.core.v1.Namespace("eureka-ns", {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
        name: "prod",
    }
});

const secret = new k8s.core.v1.Secret("eureka-secret", {
    metadata: {
        name: "prod",
        namespace: ns.metadata.name,
    },
    type: "Opaque",
    stringData: {
        databaseUser: `${config.require("databaseUser")}`,
        databasePassword: `${config.require("databasePassword")}`,
        applicationKey: `${config.require("applicationKey")}`,
        databaseName: `${config.require("databaseName")}`,
        databaseHost: `${config.require("databaseHost")}`
    },
});

const envVars = [
    {
        name: "DB_NAME",
        valueFrom: {
            secretKeyRef: {
                name: "prod",
                key: "databaseName"
            }
        }
    },
    {
        name: "DB_PASSWORD",
        valueFrom: {
            secretKeyRef: {
                name: "prod",
                key: "databasePassword"
            }
        }
    },
    {
        name: "DB_USER",
        valueFrom: {
            secretKeyRef: {
                name: "prod",
                key: "databaseUser"
            }
        }
    },
    {
        name: "DB_HOST",
        valueFrom: {
            secretKeyRef: {
                name: "prod",
                key: "databaseHost"
            }
        }
    },
    {
        name: "SECRET_KEY",
        valueFrom: {
            secretKeyRef: {
                name: "prod",
                key: "applicationKey"
            }
        }
    },
    {
        name: "DJANGO_SETTINGS_MODULE",
        value: "eureka.settings.production"
    }
];

const imageApi = pulumi.output(docker.getRegistryImage({
    name: "thehubaubg/unimorph-backend",
}, { async: true }));

const deployment = new k8s.apps.v1.Deployment("api", {
    metadata: {
        namespace: ns.metadata.name,
    },
    spec: {
        selector: { matchLabels: appLabels },
        replicas: 1,
        template: {
            metadata: {
                namespace: ns.metadata.name,
                labels: appLabels,
            },
            spec: {
                initContainers: [
                    {
                        name: "migrations",
                        image: "thehubaubg/unimorph-backend",
                        command: [ "python", "manage.py" ],
                        args: [ "makemigrations api", "migrate" ],
                        env: envVars,
                        resources: {
                            requests: {
                                cpu: "150m",
                                memory: "150Mi",
                            },
                            limits: {
                                cpu: "200m",
                                memory: "200Mi",
                            }
                        },
                    }
                ],
                containers: [
                    {
                        name: "api",
                        image: "thehubaubg/unimorph-backend",
                        imagePullPolicy: "Always",
                        env: envVars,
                        ports: [
                            {
                                name: "http",
                                containerPort: 8000
                            }
                        ],
                        resources: {
                            requests: {
                                cpu: "150m",
                                memory: "250Mi",
                            },
                            limits: {
                                cpu: "250m",
                                memory: "400Mi",
                            }
                        },

                    }
                ]
            }
        }
    }
});
exports.name = deployment.metadata.name;
exports.id = imageApi.id;
exports.name = imageApi.name;
exports.sha = imageApi.sha256Digest;