.PHONY: test install build release

test:
	python3 -m pytest

install:
	pip install -e cli/
	pip install -e mcp-context-server/
	pip install -e worker-cli/

build:
	cd cli && uv build
	cd mcp-context-server && uv build
	cd worker-cli && uv build

release:
	@test -n "$(VERSION)" || (echo "Usage: make release VERSION=x.y.z" && exit 1)
	@echo "$(VERSION)" > VERSION
	@sed -i 's/^## \[Unreleased\]/## [$(VERSION)] - $(shell date +%Y-%m-%d)/' CHANGELOG.md
	$(MAKE) build
	@echo "Released $(VERSION)"
