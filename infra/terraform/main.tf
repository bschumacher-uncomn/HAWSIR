# NAVIFI lab cluster: one RHEL 9 node running RKE2 and UDS Core, added to the
# existing bd-lab VPC behind the existing bd-lab ALB.
#
#   https://navifi.uds.demo.uncomn.ai      anyone          -> node:30080 -> Istio tenant gateway -> NAVIFI
#   https://slides.uds.demo.uncomn.ai      anyone          -> node:30080 -> Istio tenant gateway -> the HAWSIR deck
#   https://<host>.uds.demo.uncomn.ai      operator CIDRs  -> node:30080 -> Istio tenant gateway -> Keycloak sign-in, UDS portal
#   https://<ui>.admin.uds.demo.uncomn.ai  operator CIDRs  -> node:30081 -> Istio admin gateway  -> Grafana, Keycloak admin
#
# Any other request under the domain gets a 404 from the ALB (rules in edge.tf).
#
# The ALB terminates TLS with this stack's ACM certificate; the gateways serve
# plain HTTP on NodePorts that only the ALB security group can reach. There is
# no SSH: the node is reached through SSM.
#
# The bd-lab stack itself is never modified. This stack only adds to it:
# listener rules, a listener certificate, and egress rules on the ALB security group.

locals {
  name = "${var.lab_name}-uds"

  # Istio gateway NodePorts. These must match the gateway Service overrides in
  # infra/cluster/uds-bundle.yaml.
  gateways = {
    tenant = { hosts = "*.${var.domain}", http_port = 30080, status_port = 30021 }
    admin  = { hosts = "*.admin.${var.domain}", http_port = 30081, status_port = 30022 }
  }

  gateway_ports = merge([
    for gw, g in local.gateways : {
      "${gw}-http"   = g.http_port
      "${gw}-status" = g.status_port
    }
  ]...)
}

data "aws_caller_identity" "current" {}

data "aws_vpc" "lab" {
  tags = { Name = var.lab_name }
}

data "aws_subnet" "node" {
  vpc_id = data.aws_vpc.lab.id
  tags   = { Name = "${var.lab_name}-public-0" }
}

data "aws_lb" "lab" {
  name = var.lab_name
}

data "aws_lb_listener" "https" {
  load_balancer_arn = data.aws_lb.lab.arn
  port              = 443
}

data "aws_security_group" "alb" {
  vpc_id = data.aws_vpc.lab.id
  name   = "${var.lab_name}-alb"
}

data "aws_route53_zone" "public" {
  name         = var.zone_name
  private_zone = false
}

data "aws_ami" "rhel" {
  most_recent = true
  owners      = ["309956199498"] # Red Hat

  filter {
    name   = "name"
    values = ["RHEL-${var.rhel_release}.*_HVM-*-x86_64-*-Hourly2-GP3"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}
