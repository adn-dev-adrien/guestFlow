- **The admin session cookie is `__Host-` prefixed under HTTPS** (`specs/gate-access-portier.md` §4.3):
  the guests' app is a sibling host of the admin app, and the prefix stops a cookie set there from
  shadowing the operator's session. Deploying logs the operator out once.
- **Uploading the company logo also updates the icon of the guests' app**, pushed to Portier.
