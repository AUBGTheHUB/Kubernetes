import * as pulumi from "@pulumi/pulumi";
import * as docker from "@pulumi/docker";
import * as k8s from "@pulumi/kubernetes";

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
        applicationKey: `${config.require("applicationKey")}`,
        databaseUser: `${config.require("databaseUser")}`,
        databasePassword: `${config.require("databasePassword")}`,
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

const proxyConfig = new k8s.core.v1.ConfigMap("nginx-config", {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
        name: "nginx.conf",
        namespace: ns.metadata.name,
    },
    data: {
        "nginx.conf": `
        error_log /var/log/nginx/error.log;
          upstream app {
            server localhost:8000;
          }
          server {
            listen 80;
            location / {
              proxy_set_header Host $host;
              proxy_set_header X-Real-IP $remote_addr;
              root /usr/share/nginx/html;
              try_files $uri /index.html;
            }
            location /api {
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_pass http://app;
            }
            location /admin {
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_pass http://app;
            }
            location /static {
                alias /usr/share/nginx/html/static;
            }
          }`
    }
});

const imageApi = pulumi.output(docker.getRegistryImage({
    name: "thehubaubg/api",
}));

const imageFrontend = pulumi.output(docker.getRegistryImage({
    name: "thehubaubg/frontend",
}));

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
                volumes: [
                    {
                        name: "nginx-conf",
                        configMap: {
                            name: "nginx.conf",
                        },
                    },
                ],
                initContainers: [
                    {
                        name: "migrations",
                        image: imageApi.apply(image => {
                            return `${image.name}@${image.sha256Digest}`
                        }),
                        imagePullPolicy: "Always",
                        command: [ "/bin/sh" ],
                        args: [ "-c", "python", "manage.py", "makemigrations", "api;", "python", "manage.py", "migrate" ],
                        env: envVars,
                        resources: {
                            requests: {
                                cpu: "50m",
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
                        image: imageApi.apply(image => {
                            return `${image.name}@${image.sha256Digest}`
                        }),
                        imagePullPolicy: "Always",
                        env: envVars,
                        ports: [
                            {
                                name: "http",
                                containerPort: 8000,
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
                    },
                    {
                        name: "proxy",
                        image: imageFrontend.apply(image => {
                            return `${image.name}@${image.sha256Digest}`
                        }),
                        imagePullPolicy: "Always",
                        volumeMounts: [
                            {
                                name: "nginx-conf",
                                mountPath: "/etc/nginx/nginx.conf",
                                subPath: "nginx.conf"
                            },
                        ],
                        ports: [
                            {
                                name: "http",
                                containerPort: 80,
                                hostPort: 80,
                            },
                        ],
                        resources: {
                            requests: {
                                cpu: "200m",
                                memory: "250Mi",
                            },
                            limits: {
                                cpu: "400m",
                                memory: "500Mi",
                            },
                        },
                    },
                ]
            }
        }
    }
});

// const service = new k8s.core.v1.Service("frontend", {
//     kind: "Service",
//     metadata: {
//         namespace: ns.metadata.name,
//     },
//     spec: {
//         selector: {
//             matchLabels: appLabels,
//         },
//     }
// });