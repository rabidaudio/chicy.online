# [static-chic.online](https://static-chic.online)

A multi-tenant static site host. Sites are stored in S3 buckets and served via CloudFront. Supports custom domains and arbitrary rollbacks.

```bash
./bin/admin # admin management cli
npm run serve # run a local tunnel to test API
npm run publish # deploy
npx sls logs -f api # show logs
```

# API

```bash
# Deploy
curl -X POST \
    -H 'Authorization: Bearer <token>' \    # if using user authentication
    -H 'Deploy-Key: <deploy key>' \         # in place of bearer token, the deploy key allows creation
    \                                       # and promotion of sites but no other permissions (for automation)
    -H 'Content-Type: application/gzip' \   # your compiled site content should be uploaded
    --data-binary @mysite.tar.gz \          # as the binary body of the request in a gzipped tarball
    https://api.static-chic.online/sites/:siteId/deployments
# 200 Response: {
#     "status": "OK",
#     "data": {
#         siteId: 'prison-mentor-ydd8c',
#         deploymentId: '0000019cc58b808eb0c1dfe5'
#         createdAt: '2026-03-06T23:46:19.919Z',
#     }
# }

# Deployments are staged but not immediately deployed.
# To make the deployment live, promote it:
curl -X POST \
    -H 'Authorization: Bearer <token>' \
    -H 'Deploy-Key: <deploy key>' \
    https://api.static-chic.online/sites/:siteId/deployments/:deploymentId/promote

# Rollback is as simple as promoting a previous deployment
```

## Development

```bash
pipx install git-remote-s3
```

# TODO

- breakup app
- deploy keys
- production deploy
- Github authentication
- deploy CLI
- frontend
- add Tags to everything for cost tracking
- flag for private-only in sls to disable github logins
- json vs text outputs from cli
- complete integration tests
- 404 returns 403 Permission Denied instead
- cli option for using git-remote-s3 directly
- regenerate deploy key command
- add optional messages to deployments
- use git-short-sha algorithm to show short deployment ids


----

1. save auth-request with securerandom authreq
2. send user to below, passing authreq in state

https://github.com/login/oauth/authorize ?client_id=...&state=...

3. app polls API with authreq waiting for auth

when user authenticates, API is called:

https://api.dev.static-chic.online/oauth/github/callback ?code=... & state=...

4. API finds existing authReq from state
5. API gets access token

POST https://github.com/login/oauth/access_token ?
    "client_id" => CLIENT_ID,
    "client_secret" => CLIENT_SECRET,
    "code" => code
    -> access_token expires_in refresh_token refresh_token_expires_in

GET https://api.github.com/user
    Authorization: Bearer access_token
    -> user_info

6. API upserts user record, saving access token to authreq and refresh token to user. points authreq to user
7. When authreq is polled again, returns authreq+access_token and deletes
8. client saves auth_token

later for auth

1. client makes api call with access token
2. server checks if access token is valid. If so finds user by userId, continues
3. else checks refresh token. If valid, sends new access token to client, continues
4. else auth failed, need to re-auth

------


POST https://github.com/login/device/code
    body: application/x-www-form-urlencoded CLIENT_ID
        -> JSON verification_uri, user_code, device_code, and interval

send user to verification_uri to input user_code

Poll for access token:

POST https://github.com/login/oauth/access_token
    body: application/x-www-form-urlencoded CLIENT_ID, device_code, grant_type=urn:ietf:params:oauth:grant-type:device_code
        -> JSON error,access_token

save access token

verify validity

GET https://api.github.com/user
    "Accept" => "application/vnd.github+json", "Authorization" => "Bearer #{token}"

