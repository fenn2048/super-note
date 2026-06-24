## 2025-06-24 - SMTP Encryption Hardening
**Vulnerability:** Hardcoded fallback secret for SMTP password encryption in `backend/src/services/email.ts`.
**Learning:** Security-critical encryption was relying on a weak hardcoded fallback when the environment variable was missing, even in production-like settings.
**Prevention:** Always use the centralized, production-enforced `JWT_SECRET` from `lib/auth-security.ts` for all sensitive encryption tasks to ensure strong entropy is mandatory.

## 2025-06-24 - Attachment XSS Prevention
**Vulnerability:** XSS risk via `?inline=1` on attachments allowing HTML/SVG rendering in the same origin.
**Learning:** Providing an "inline" preview feature for user-uploaded files can inadvertently bypass same-origin policy if the browser executes scripts within those files.
**Prevention:** Always serve user-uploaded content with a strict `Content-Security-Policy: default-src 'none'; sandbox;` header when rendered inline to disable script execution and isolate the content.
