output "instance_id" {
  value = aws_instance.node.id
}

output "navifi_url" {
  value = "https://navifi.${var.domain}"
}

output "operator_urls" {
  description = "Reachable only from operator_cidrs."
  value = {
    grafana        = "https://grafana.admin.${var.domain}"
    keycloak_admin = "https://keycloak.admin.${var.domain}"
    keycloak_login = "https://sso.${var.domain}"
    portal         = "https://portal.${var.domain}"
  }
}

output "ssm_shell" {
  description = "Shell on the node as ec2-user."
  value       = "aws ssm start-session --region ${var.region} --target ${aws_instance.node.id} --document-name AWS-StartInteractiveCommand --parameters command='sudo -iu ec2-user'"
}

output "target_health" {
  description = "Whether the ALB sees each gateway as healthy."
  value = {
    for gw, tg in aws_lb_target_group.gateway :
    gw => "aws elbv2 describe-target-health --region ${var.region} --target-group-arn ${tg.arn} --query 'TargetHealthDescriptions[].TargetHealth.State' --output text"
  }
}
