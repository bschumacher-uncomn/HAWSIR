# ---------------------------------------------------------------- TLS

# The lab listener's certificate covers *.demo.uncomn.ai, one level only. This
# one covers both gateway wildcards and is attached to the same listener (SNI).
resource "aws_acm_certificate" "uds" {
  provider                  = aws.untagged
  domain_name               = local.gateways.tenant.hosts
  subject_alternative_names = [local.gateways.admin.hosts]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.uds.domain_validation_options : dvo.domain_name => dvo
  }
  zone_id         = data.aws_route53_zone.public.zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "uds" {
  certificate_arn         = aws_acm_certificate.uds.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

resource "aws_lb_listener_certificate" "uds" {
  listener_arn    = data.aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate_validation.uds.certificate_arn
}

# ---------------------------------------------------------------- routing

# Health checks hit the gateway's Envoy readiness endpoint, so a target is
# healthy only when Istio is serving.
resource "aws_lb_target_group" "gateway" {
  for_each    = local.gateways
  name        = "${local.name}-${each.key}"
  port        = each.value.http_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.lab.id
  target_type = "instance"

  deregistration_delay = 30

  health_check {
    port                = each.value.status_port
    path                = "/healthz/ready"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

# Listener rules, first match wins:
#
#   priority  host                 source           action
#   3         public_hosts         anyone           forward to the tenant gateway
#   4         *.admin.<domain>     operator_cidrs   forward to the admin gateway
#   5         *.<domain>           operator_cidrs   forward to the tenant gateway
#   6         *.<domain>           anyone else      404
#
# ALB host wildcards match across dots, so *.<domain> also matches every admin
# host, and the lab's own rule (priority 10, *.demo.uncomn.ai) matches all of
# them. Every rule here therefore has a priority below 10, so the ALB checks it
# before the lab's rule.

resource "aws_lb_listener_rule" "public" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 3

  condition {
    host_header {
      values = [for host in var.public_hosts : "${host}.${var.domain}"]
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway["tenant"].arn
  }
}

resource "aws_lb_listener_rule" "operator" {
  for_each     = length(var.operator_cidrs) > 0 ? { admin = 4, tenant = 5 } : {}
  listener_arn = data.aws_lb_listener.https.arn
  priority     = each.value

  condition {
    host_header {
      values = [local.gateways[each.key].hosts]
    }
  }
  condition {
    source_ip {
      values = var.operator_cidrs
    }
  }

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway[each.key].arn
  }
}

resource "aws_lb_listener_rule" "closed" {
  listener_arn = data.aws_lb_listener.https.arn
  priority     = 6

  condition {
    host_header {
      values = [local.gateways.tenant.hosts]
    }
  }

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "not found"
      status_code  = "404"
    }
  }
}

# ---------------------------------------------------------------- DNS

resource "aws_route53_record" "gateway" {
  for_each = local.gateways
  zone_id  = data.aws_route53_zone.public.zone_id
  name     = each.value.hosts
  type     = "A"

  alias {
    name                   = data.aws_lb.lab.dns_name
    zone_id                = data.aws_lb.lab.zone_id
    evaluate_target_health = false
  }
}
