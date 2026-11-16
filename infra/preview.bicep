targetScope = 'resourceGroup'

param appName string
param location string = resourceGroup().location
param managedEnvironmentId string
param imageDigestRef string

// §6.4: Preview app has max 1 replica, capped CPU/memory, scale-to-zero, NO secrets, and NO managed identity.
resource previewApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: managedEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
      }
    }
    template: {
      containers: [
        {
          name: 'preview'
          image: imageDigestRef
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'DEMO_SEED_MODE'
              value: 'synthetic'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output previewUrl string = 'https://${previewApp.properties.configuration.ingress.fqdn}'
