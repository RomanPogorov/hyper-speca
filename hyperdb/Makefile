# hyperdb — PostgreSQL 18 + hyper's extensions, built from source into dist/pg18.
#
#   make            build everything and run the smoke check
#   make restore    load a backup of the live database (SRC=postgres://…) and compare
#   make install    copy dist/ to ~/.hyper/hyperdb/pg18 with relocated library paths (DEST=… to change)
#   make init       install + initdb + hyperd unit hyper-db (first setup on a machine)
#   make sums       check the sha256 pins in versions.env (./sums.sh --update after a version bump)
#   make package    dist/hyperdb-<pg>-<arch>.tar.gz
#   make clean      drop build/ and dist/
SHELL := /bin/bash
include versions.env
ARCH := $(shell uname -m)
PKG := dist/hyperdb-$(PG_VERSION)-$(ARCH).tar.gz

all: build

build:
	./build.sh pg vector cron ivm search check

check:
	./build.sh check

restore:
	./test-restore.sh

install:
	./install.sh

init:
	./install.sh --init

sums:
	./sums.sh

package: build
	tar -C dist -czf $(PKG) pg$(firstword $(subst ., ,$(PG_VERSION)))
	@ls -lh $(PKG)

clean:
	rm -rf build dist

.PHONY: all build check restore install init sums package clean
