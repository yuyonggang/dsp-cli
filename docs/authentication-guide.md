# Authentication Guide

This document explains the authentication mechanism of SAP Datasphere CLI, including OAuth auto-discovery, token caching, and troubleshooting.

## Overview

This project uses **OAuth 2.0 Authorization Code Flow** to authenticate with SAP Datasphere. The CLI automatically handles the following workflow:

1. **OpenID Connect Auto-Discovery** - Automatically retrieves authorization and token endpoints
2. **Browser Authorization** - Opens browser for authorization on first login
3. **Token Caching** - Saves access_token and refresh_token to avoid repeated logins
4. **Token Refresh** - Automatically refreshes tokens using refresh_token when expired

## Configuration Requirements

Only 3 required variables need to be configured in the `.env` file:

```bash
DATASPHERE_HOST=https://your-tenant.eu10.hcs.cloud.sap
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
```

### How to Obtain OAuth Credentials

1. Log in to SAP Datasphere UI
2. Navigate to **System → Administration → App Integration**
3. Create a new OAuth Client
4. Select **"Authorization Code"** flow
5. Copy the Client ID and Client Secret
6. Fill the credentials into the `.env` file

## OAuth Auto-Discovery Mechanism

### OpenID Connect Discovery

The CLI automatically calls the OpenID Connect discovery endpoint to retrieve OAuth configuration:

```
GET https://{tenant}.authentication.{region}.hana.ondemand.com/.well-known/openid-configuration
```

**Key information returned:**
- `authorization_endpoint` - Authorization endpoint URL
- `token_endpoint` - Token endpoint URL
- `token_endpoint_auth_methods_supported` - Supported authentication methods

### Why Manual Endpoint Configuration is No Longer Needed

The old version required configuring these in `.env`:
```bash
# ❌ No longer needed
AUTHORIZATION_URL=https://...
TOKEN_URL=https://...
```

Now these endpoints are automatically retrieved through **OpenID Discovery**, following standard protocols, making it more robust and maintainable.

## Token Caching Mechanism

### Cache Location

Tokens are saved at:
```
~/.@sap/datasphere-cli/.cache/secrets.json
```

### Cache Structure

```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "7c8f3a...",
  "expires_in": 3599,
  "expires_after": 1775853968
}
```

### Token Lifetime

- **Access Token**: 1 hour (3599 seconds)
- **Refresh Token**: Used to automatically refresh the access token
- The CLI automatically refreshes the access token using refresh_token when it expires

### Login Behavior

The login behavior depends on whether the `--force` flag is used in the `authenticate()` function.

#### Without `--force` (Recommended - Default in this project)

**First skill execution:**
1. Check cache, no valid token found
2. Open browser and redirect to authorization page
3. After user authorization, CLI obtains and caches the token
4. Execute skill operation

**Subsequent executions:**
1. Check cache, valid token found
2. Prompt: "Secret for tenant ... already exists. Do you want to overwrite it? (Y/n)"
3. Answer "n" to use cached token (no browser opened)
4. Execute skill operation using cached credentials

**Benefits:**
- ✅ Token reuse - faster execution after first login
- ✅ User control - you decide whether to re-authenticate
- ✅ Offline capability - works with cached tokens when offline

#### With `--force: true` (Not Recommended)

**Every execution:**
1. Ignore cached token
2. **Always** open browser for authorization
3. Overwrite cached token with new one
4. Execute skill operation

**Why not recommended:**
- ❌ Browser opens every time (annoying)
- ❌ Wastes time on repeated authorizations
- ❌ Ignores token caching mechanism
- ❌ Can't work offline

### The `--force` Flag

**Location in code:**
```javascript
// In skills/*/authenticate() function
await commands["login"]({
  "--host": HOST,
  "--client-id": CLIENT_ID,
  "--client-secret": CLIENT_SECRET,
  "--authorization-flow": "authorization_code",
  "--force": true,  // ⬅️ This flag controls behavior
});
```

**How to enable/disable:**

| Behavior | Code Setting | When to Use |
|----------|--------------|-------------|
| **Use cached tokens** (default) | Remove `"--force": true` line | Normal daily usage - reuse tokens |
| **Force re-login** | Keep `"--force": true` | Testing, credential changes, debugging auth issues |

**To disable force mode (recommended):**
```javascript
// ✅ Recommended - Uses token cache
await commands["login"]({
  "--host": HOST,
  "--client-id": CLIENT_ID,
  "--client-secret": CLIENT_SECRET,
  "--authorization-flow": "authorization_code",
  // No --force flag
});
```

**To enable force mode:**
```javascript
// ⚠️ Use only for testing - Always opens browser
await commands["login"]({
  "--host": HOST,
  "--client-id": CLIENT_ID,
  "--client-secret": CLIENT_SECRET,
  "--authorization-flow": "authorization_code",
  "--force": true,  // Forces browser login every time
});
```

**Current project status:**
All skills in this project have `--force` disabled by default, enabling efficient token reuse.

## Testing OpenID Discovery

You can manually test if auto-discovery is working correctly:

```bash
# Replace with your tenant and region
curl https://dwc-field-training.authentication.eu10.hana.ondemand.com/.well-known/openid-configuration
```

**Expected response:**
```json
{
  "issuer": "https://dwc-field-training.authentication.eu10.hana.ondemand.com/oauth/token",
  "authorization_endpoint": "https://dwc-field-training.authentication.eu10.hana.ondemand.com/oauth/authorize",
  "token_endpoint": "https://dwc-field-training.authentication.eu10.hana.ondemand.com/oauth/token",
  "token_endpoint_auth_methods_supported": [
    "client_secret_post",
    "client_secret_basic"
  ],
  ...
}
```

## Troubleshooting

### Issue: Browser Opens Every Time

**Cause:** The `--force: true` flag is used in the code

**Solution:** Check the `authenticate()` function and remove `--force: true`:

```javascript
// ❌ Wrong - Forces re-login every time
await commands["login"]({
  "--host": HOST,
  "--client-id": CLIENT_ID,
  "--client-secret": CLIENT_SECRET,
  "--authorization-flow": "authorization_code",
  "--force": true,  // Remove this line
});

// ✅ Correct - Uses cached token
await commands["login"]({
  "--host": HOST,
  "--client-id": CLIENT_ID,
  "--client-secret": CLIENT_SECRET,
  "--authorization-flow": "authorization_code",
});
```

### Issue: Token Expired Error

**Solution:** Manually clear the cache and re-login

```bash
rm -rf ~/.@sap/datasphere-cli/.cache/secrets.json
```

### Issue: Authorization Endpoint Not Found

**Possible causes:**
1. DATASPHERE_HOST is incorrectly configured
2. Tenant or region mismatch
3. Network issue, unable to access `.well-known/openid-configuration`

**Solutions:**
1. Check DATASPHERE_HOST format: `https://{tenant}.{region}.hcs.cloud.sap`
2. Manually test the discovery endpoint (see above)
3. Check network connectivity

### Issue: Invalid Client ID or Secret

**Error message:**
```
401 Unauthorized
Invalid client credentials
```

**Solutions:**
1. Regenerate OAuth Client in Datasphere UI
2. Ensure the complete Client ID and Secret are copied (including special characters)
3. Update the `.env` file

## Security Best Practices

1. **Do not commit .env file to Git**
   - `.env` is already excluded in `.gitignore`
   - Only commit `.env.example` as a template

2. **Rotate credentials regularly**
   - Periodically regenerate OAuth Client in Datasphere UI
   - Especially when credential leakage is suspected

3. **Use environment-specific credentials**
   - Use different OAuth Clients for development and production environments
   - Limit the permission scope of the Client

## References

- [SAP Datasphere CLI Documentation](https://www.npmjs.com/package/@sap/datasphere-cli)
- [OpenID Connect Discovery](https://openid.net/specs/openid-connect-discovery-1_0.html)
- [OAuth 2.0 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/)
