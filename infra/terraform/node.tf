# ---------------------------------------------------------------- security groups

resource "aws_security_group" "node" {
  name        = "${local.name}-node"
  description = "NAVIFI lab node: Istio gateway NodePorts from the lab ALB only. No SSH."
  vpc_id      = data.aws_vpc.lab.id
  tags        = { Name = "${local.name}-node" }
}

resource "aws_vpc_security_group_ingress_rule" "node_from_alb" {
  for_each                     = local.gateway_ports
  security_group_id            = aws_security_group.node.id
  description                  = "Istio ${each.key} NodePort from the lab ALB"
  referenced_security_group_id = data.aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

resource "aws_vpc_security_group_egress_rule" "node_all" {
  security_group_id = aws_security_group.node.id
  description       = "OS packages, container images, git, AWS APIs"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# The lab ALB security group has no default egress, so it needs a rule per port.
resource "aws_vpc_security_group_egress_rule" "alb_to_node" {
  for_each                     = local.gateway_ports
  security_group_id            = data.aws_security_group.alb.id
  description                  = "${local.name} Istio ${each.key} NodePort"
  referenced_security_group_id = aws_security_group.node.id
  ip_protocol                  = "tcp"
  from_port                    = each.value
  to_port                      = each.value
}

# ---------------------------------------------------------------- IAM

resource "aws_iam_role" "node" {
  name        = "${local.name}-node"
  description = "NAVIFI lab node. SSM access only."
  # Created by an admin (bd-infra iam/policies/node-boundary.json). The deployer
  # can only create roles that carry it.
  permissions_boundary = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/bd-infra-node-boundary"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "node_ssm" {
  role       = aws_iam_role.node.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "node" {
  name = "${local.name}-node"
  role = aws_iam_role.node.name
}

# ---------------------------------------------------------------- node

resource "aws_instance" "node" {
  ami                         = data.aws_ami.rhel.id
  instance_type               = var.instance_type
  subnet_id                   = data.aws_subnet.node.id
  vpc_security_group_ids      = [aws_security_group.node.id]
  iam_instance_profile        = aws_iam_instance_profile.node.name
  associate_public_ip_address = true # egress without a NAT gateway; the security group admits only the ALB
  disable_api_termination     = var.termination_protection

  user_data = templatefile("${path.module}/user-data.sh", {
    region = var.region
    domain = var.domain
  })

  # Hop limit 1: pods cannot reach instance metadata, so they cannot use the
  # node role.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  tags = { Name = "${local.name}-node" }

  lifecycle {
    # A newer AMI or edited first-boot script must not replace a running node.
    ignore_changes = [ami, user_data]
  }
}

resource "aws_lb_target_group_attachment" "gateway" {
  for_each         = local.gateways
  target_group_arn = aws_lb_target_group.gateway[each.key].arn
  target_id        = aws_instance.node.id
  port             = each.value.http_port
}
