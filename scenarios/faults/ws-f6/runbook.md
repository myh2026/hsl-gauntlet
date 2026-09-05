# Runbook

## api-gateway error budget
The api-gateway prometheus alert family tracks 5xx burn.
If error_rate > 0.02 sustained, check recent deploys and saturation.

## saturation playbook
Check cpu_usage and saturation. If saturation > 0.75, roll back the latest deploy.
