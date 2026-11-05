variable "region" {
  type    = string
  default = "us-east-1"
}

variable "lab_name" {
  description = "Name of the existing bd-infra lab. Its VPC, subnets, ALB and ALB security group are looked up by this name."
  type        = string
  default     = "bd-lab"
}

variable "zone_name" {
  description = "Existing public Route 53 zone that the domain sits under."
  type        = string
  default     = "uncomn.ai"
}

variable "domain" {
  description = "UDS Core domain. Apps are served at <host>.<domain>, admin UIs at <host>.admin.<domain>."
  type        = string
  default     = "uds.demo.uncomn.ai"
}

variable "public_hosts" {
  description = "Hosts on the tenant gateway that anyone may reach, as <host>.<domain>. Must match the hosts the apps expose in their UDS Package."
  type        = list(string)
  default     = ["navifi"]

  validation {
    # An ALB rule takes at most five condition values.
    condition     = length(var.public_hosts) >= 1 && length(var.public_hosts) <= 5
    error_message = "Give between 1 and 5 public hosts."
  }
}

variable "operator_cidrs" {
  description = "Source CIDRs that may reach everything else on the cluster: the admin UIs (Grafana, Keycloak admin console) and the tenant hosts not in public_hosts (Keycloak sign-in, UDS portal). Empty closes them to everyone."
  type        = list(string)
  default     = []

  validation {
    # An ALB rule takes at most five condition values and the host header uses one.
    condition     = length(var.operator_cidrs) <= 4
    error_message = "At most 4 CIDRs fit in an operator listener rule."
  }
}

variable "rhel_release" {
  description = "RHEL minor release. The newest Red Hat image for it is used when the node is created."
  type        = string
  default     = "9.8"
}

variable "instance_type" {
  description = "EC2 instance type. The default has 8 vCPU and 32 GiB; UDS Core is trimmed to fit (infra/README.md, Sizing)."
  type        = string
  default     = "m7i.2xlarge"
}

variable "root_volume_gb" {
  description = "Holds the Zarf registry, container images, Loki chunks and Velero backups."
  type        = number
  default     = 150
}

variable "termination_protection" {
  description = "Blocks terminating the node through the API. Set to false and apply before terraform destroy."
  type        = bool
  default     = true
}
