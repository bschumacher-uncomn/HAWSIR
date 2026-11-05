terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Same state bucket as the bd-infra lab, under its own key. The deployer may
  # only write keys under lab/. Account-specific values are supplied at init so
  # nothing account-specific is committed:
  #
  #   terraform -chdir=infra/terraform init \
  #     -backend-config="bucket=bd-infra-tfstate-<account id>" \
  #     -backend-config="key=lab/navifi-uds/terraform.tfstate" \
  #     -backend-config="region=us-east-1"
  backend "s3" {
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region

  # Project=bd-infra is what lets bd-infra-deployer create or change a resource.
  default_tags {
    tags = {
      Project     = "bd-infra"
      Environment = "lab"
      Stack       = "navifi-uds"
      ManagedBy   = "terraform"
    }
  }
}

# The deployer may request ACM certificates but not tag or delete them, so the
# certificate uses a provider without default tags.
provider "aws" {
  alias  = "untagged"
  region = var.region
}
