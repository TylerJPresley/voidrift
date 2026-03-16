# Skill: Compliance & Privacy

## Core Philosophy
- **Privacy by Design:** Integrate data protection into the system architecture from the start.
- **Trust through Transparency:** Be clear about what data is collected, why, and how it is protected.
- **Regulatory Adherence:** Proactively comply with global standards (GDPR, SOC2, HIPAA, CCPA).

## Implementation Rules
- **Data Minimization:** Only collect and store the absolute minimum data required for the feature.
- **Anonymization & Masking:** Mask PII (Personally Identifiable Information) in logs, reports, and non-production environments.
- **Consent Management:** Implement robust mechanisms for user consent, tracking, and the "Right to be Forgotten."
- **Data Residency:** Ensure data is stored and processed within the required geographic boundaries (e.g., EU-only for GDPR).
- **Audit Trails:** Maintain immutable logs of all access to sensitive data and configuration changes.

## Compliance Standards
- **Access Control:** Enforce MFA (Multi-Factor Authentication) and Just-In-Time (JIT) access for administrative tasks.
- **Encryption:** Mandatory AES-256 for all PII at rest and TLS 1.3 for all data in transit.
- **Documentation:** Maintain a Data Map and Privacy Policy that accurately reflects system behavior.
