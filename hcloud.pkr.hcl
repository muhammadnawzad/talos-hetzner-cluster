# hcloud.pkr.hcl

  packer {
  required_plugins {
    hcloud = {
      source  = "github.com/hetznercloud/hcloud"
      version = "~> 1"
    }
  }
  }

  variable "talos_version" {
  type    = string
  default = "v1.12.2"
  }

  variable "arch" {
  type    = string
  default = "amd64"
  }

  variable "server_type" {
  type    = string
  default = "cx23"
  }

  variable "server_location" {
  type    = string
  default = "fsn1"
  }

  locals {
  image = "https://factory.talos.dev/image/e2e3b54334c85fdef4d78e88f880d185e0ce0ba0c9b5861bb5daa1cd6574db9b/${var.talos_version}/hcloud-${var.arch}.raw.xz"
  }

  source "hcloud" "talos" {
  rescue       = "linux64"
  image        = "debian-11"
  location     = "${var.server_location}"
  server_type  = "${var.server_type}"
  ssh_username = "root"

  snapshot_name   = "talos system disk - ${var.arch} - ${var.talos_version}"
  snapshot_labels = {
    type    = "infra",
    os      = "talos",
    version = "${var.talos_version}",
    arch    = "${var.arch}",
  }
  }

  build {
  sources = ["source.hcloud.talos"]

  provisioner "shell" {
    inline = [
      "apt-get install -y wget",
      "wget -O /tmp/talos.raw.xz ${local.image}",
      "xz -d -c /tmp/talos.raw.xz | dd of=/dev/sda && sync",
    ]
  }
  }
