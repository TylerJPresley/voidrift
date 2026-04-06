"""SSRF guard for HTTP tools (REQ-SEC-3)."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

BLOCKED_RANGES = [
    ipaddress.ip_network("169.254.0.0/16"),    # link-local
    ipaddress.ip_network("10.0.0.0/8"),         # RFC 1918
    ipaddress.ip_network("172.16.0.0/12"),      # RFC 1918
    ipaddress.ip_network("192.168.0.0/16"),     # RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),      # CGNAT
    ipaddress.ip_network("fc00::/7"),            # IPv6 unique-local
    ipaddress.ip_network("fe80::/10"),           # IPv6 link-local
    ipaddress.ip_network("::1/128"),             # IPv6 loopback
]


class SSRFError(Exception):
    pass


def check_url(url: str, allow_list: list[str] | None = None) -> None:
    """Resolve hostname and check against blocked IP ranges. Raises SSRFError if blocked."""
    hostname = urlparse(url).hostname
    if not hostname:
        raise SSRFError(f"Cannot parse hostname from URL: {url}")

    if allow_list and hostname in allow_list:
        return

    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror as e:
        raise SSRFError(f"Cannot resolve hostname '{hostname}': {e}")

    resolved = {info[4][0] for info in infos}

    for ip_str in resolved:
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue

        if allow_list:
            for entry in allow_list:
                try:
                    if ip in ipaddress.ip_network(entry, strict=False):
                        return
                except ValueError:
                    pass

        for blocked in BLOCKED_RANGES:
            if ip in blocked:
                raise SSRFError(
                    f"Request to '{url}' blocked: resolved IP {ip_str} "
                    f"is in blocked range {blocked}"
                )
