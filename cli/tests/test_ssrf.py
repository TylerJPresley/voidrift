"""Tests for SSRF guard (REQ-SEC-3)."""

from unittest.mock import patch
import socket

import pytest

from voidrift_cli.tools.ssrf_guard import check_url, SSRFError


def _mock_resolve(ip):
    def mock(*a, **kw):
        return [(2, 1, 6, "", (ip, 0))]
    return mock


class TestSSRFGuard:
    def test_link_local_blocked(self):
        with patch("socket.getaddrinfo", _mock_resolve("169.254.169.254")):
            with pytest.raises(SSRFError, match="169.254.0.0/16"):
                check_url("http://169.254.169.254/latest/meta-data/")

    def test_rfc1918_blocked(self):
        with patch("socket.getaddrinfo", _mock_resolve("10.0.0.1")):
            with pytest.raises(SSRFError, match="10.0.0.0/8"):
                check_url("http://10.0.0.1/admin")

    def test_rfc1918_172_blocked(self):
        with patch("socket.getaddrinfo", _mock_resolve("172.16.0.1")):
            with pytest.raises(SSRFError, match="172.16.0.0/12"):
                check_url("http://172.16.0.1/")

    def test_rfc1918_192_blocked(self):
        with patch("socket.getaddrinfo", _mock_resolve("192.168.1.1")):
            with pytest.raises(SSRFError, match="192.168.0.0/16"):
                check_url("http://192.168.1.1/")

    def test_cgnat_blocked(self):
        with patch("socket.getaddrinfo", _mock_resolve("100.64.0.1")):
            with pytest.raises(SSRFError, match="100.64.0.0/10"):
                check_url("http://100.64.0.1/")

    def test_loopback_allowed(self):
        with patch("socket.getaddrinfo", _mock_resolve("127.0.0.1")):
            check_url("http://localhost:8080/api")  # should not raise

    def test_public_ip_allowed(self):
        with patch("socket.getaddrinfo", _mock_resolve("93.184.216.34")):
            check_url("https://example.com/api")  # should not raise

    def test_allowlist_cidr_override(self):
        with patch("socket.getaddrinfo", _mock_resolve("10.20.30.5")):
            check_url("http://10.20.30.5/", allow_list=["10.20.30.0/24"])

    def test_allowlist_hostname_override(self):
        with patch("socket.getaddrinfo", _mock_resolve("10.0.0.1")):
            check_url("http://10.0.0.1/", allow_list=["10.0.0.1"])

    def test_dns_failure_raises(self):
        with patch("socket.getaddrinfo", side_effect=socket.gaierror("no such host")):
            with pytest.raises(SSRFError, match="Cannot resolve"):
                check_url("http://nonexistent.invalid/")

    def test_ipv6_unique_local_blocked(self):
        def mock(*a, **kw):
            return [(10, 1, 6, "", ("fd00::1", 0, 0, 0))]
        with patch("socket.getaddrinfo", mock):
            with pytest.raises(SSRFError, match="fc00::/7"):
                check_url("http://[fd00::1]/")

    def test_no_hostname_raises(self):
        with pytest.raises(SSRFError, match="Cannot parse"):
            check_url("not-a-url")
