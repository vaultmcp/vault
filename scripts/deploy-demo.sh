#!/usr/bin/env bash
# Demo site is deployed via ECS Fargate.
# To deploy: push to main and trigger a new ECS task definition revision.
# See: AWS console → ECS → cluster vaultmcp → service demo-site → Update service.
echo "Demo site deployment is managed via ECS. See AWS console." && exit 0
