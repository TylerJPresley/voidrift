.PHONY: test install build release sync setup

test:
	uv run pytest

install:
	uv pip install --system -e cli/
	uv pip install --system -e worker-cli/

setup: install sync

sync:
	@mkdir -p ~/.voidrift/resources ~/.voidrift/domain-skills
	cp -r resources/* ~/.voidrift/resources/
	cp config.yml ~/.voidrift/config.yml
	cp models.yml ~/.voidrift/models.yml
	cp worker-models.yml ~/.voidrift/worker-models.yml 2>/dev/null || true
	cp -n spinner-labels.txt ~/.voidrift/spinner-labels.txt 2>/dev/null || true
	@echo "✅ Synced to ~/.voidrift/"

build:
	cd cli && uv build
	cd worker-cli && uv build

release:
	@test -n "$(VERSION)" || (echo "Usage: make release VERSION=x.y.z" && exit 1)
	@echo "$(VERSION)" > VERSION
	@sed -i 's/^## \[Unreleased\]/## [$(VERSION)] - $(shell date +%Y-%m-%d)/' CHANGELOG.md
	$(MAKE) build
	@echo "Released $(VERSION)"
