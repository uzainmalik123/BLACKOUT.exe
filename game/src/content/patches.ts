// The code behind the deploy console (PRD CON-02, DEF-13): for each patchable hole, the real vulnerable lines of
// OWASP Juice Shop and a correct fix as a unified diff, so the player reviews what they are deploying (SCENES.md §5).
//
// The vulnerable code below is quoted from OWASP Juice Shop v20.4.0 (the TypeScript sources shipped inside the
// bkimminich/juice-shop:v20.4.0 image used by recording/compose.yaml), Copyright (c) 2014-2026 Bjoern Kimminich &
// the OWASP Juice Shop contributors, MIT licence (https://github.com/juice-shop/juice-shop/blob/master/LICENSE).
// Four of the fixes follow the "correct" code fixes Juice Shop ships for its own coding challenges
// (data/static/codefixes/); the rest are ours. Line numbers are those of the v20.4.0 files.
import type { Patch } from '../rules/vocabulary';

export interface PatchEntry {
  patch: Patch;
  /** What the deploy console lists. */
  title: string;
  /** The file inside the Juice Shop source tree. */
  file: string;
  /** First and last line of the vulnerable code, in the v20.4.0 file. */
  lines: [number, number];
  /** The vulnerable lines, as they are in v20.4.0. */
  vulnerable: string;
  /** The fix as a unified diff against `file`. */
  diff: string;
  /** One sentence on why the fix closes the hole. */
  why: string;
}

export const PATCHES: readonly PatchEntry[] = [
  {
    patch: 'login',
    title: 'Login: parameterised query',
    file: 'routes/login.ts',
    lines: [34, 34],
    vulnerable:
      "    models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email || ''}' AND password = '${security.hash(req.body.password || '')}' AND deletedAt IS NULL`, { model: UserModel, plain: true })",
    diff: `--- a/routes/login.ts
+++ b/routes/login.ts
@@ -31,7 +31,8 @@
   return (req: Request, res: Response, next: NextFunction) => {
     verifyPreLoginChallenges(req)
-    models.sequelize.query(\`SELECT * FROM Users WHERE email = '\${req.body.email || ''}' AND password = '\${security.hash(req.body.password || '')}' AND deletedAt IS NULL\`, { model: UserModel, plain: true })
+    models.sequelize.query('SELECT * FROM Users WHERE email = $1 AND password = $2 AND deletedAt IS NULL',
+      { bind: [req.body.email || '', security.hash(req.body.password || '')], model: UserModel, plain: true })
       .then((authenticatedUser) => {
         const user = utils.queryResultToJson(authenticatedUser)
`,
    why: 'The email and password hash travel as bound parameters, so whatever the visitor types is compared as a value and can never change the shape of the query.',
  },
  {
    patch: 'registration',
    title: 'Registration: no role from the form',
    file: 'server.ts',
    lines: [549, 556],
    vulnerable: `    if (name === 'User') {
      resource.create.send.before((req: Request, res: Response, context: { instance: { id: any }, continue: any }) => {
        WalletModel.create({ UserId: context.instance.id }).catch((err: unknown) => {
          console.log(err)
        })
        return context.continue
      })
    }`,
    diff: `--- a/server.ts
+++ b/server.ts
@@ -547,10 +547,14 @@
     // create a wallet when a new user is registered using API
     if (name === 'User') {
+      resource.create.write.before((req: Request, res: Response, context: { continue: any }) => {
+        delete req.body.role // the role is never the visitor's to choose
+        return context.continue
+      })
       resource.create.send.before((req: Request, res: Response, context: { instance: { id: any }, continue: any }) => {
         WalletModel.create({ UserId: context.instance.id }).catch((err: unknown) => {
           console.log(err)
         })
         return context.continue
       })
     }
`,
    why: 'The generated REST resource writes every field of the posted body into the new Users row, so dropping the role field from the body before the write leaves every self-registered account with the model\'s default role, customer.',
  },
  {
    patch: 'search',
    title: 'Product search: parameterised query',
    file: 'routes/search.ts',
    lines: [23, 23],
    vulnerable:
      "    models.sequelize.query(`SELECT * FROM Products WHERE ((name LIKE '%${criteria}%' OR description LIKE '%${criteria}%') AND deletedAt IS NULL) ORDER BY name`)",
    diff: `--- a/routes/search.ts
+++ b/routes/search.ts
@@ -20,7 +20,10 @@
   return (req: Request, res: Response, next: NextFunction) => {
     let criteria: any = req.query.q === 'undefined' ? '' : req.query.q ?? ''
     criteria = (criteria.length <= 200) ? criteria : criteria.substring(0, 200)
-    models.sequelize.query(\`SELECT * FROM Products WHERE ((name LIKE '%\${criteria}%' OR description LIKE '%\${criteria}%') AND deletedAt IS NULL) ORDER BY name\`)
+    models.sequelize.query(
+      'SELECT * FROM Products WHERE ((name LIKE :criteria OR description LIKE :criteria) AND deletedAt IS NULL) ORDER BY name',
+      { replacements: { criteria: \`%\${criteria}%\` } }
+    )
       .then(([products]: any) => {
         const dataString = JSON.stringify(products)
`,
    why: 'The search text becomes a bound LIKE pattern instead of part of the SQL, so it can only ever match product names and descriptions, never add a UNION of another table.',
  },
  {
    patch: 'basket-ownership',
    title: 'Baskets: only your own',
    file: 'routes/basket.ts',
    lines: [18, 19],
    vulnerable: `      const id = req.params.id
      const basket = await BasketModel.findOne({ where: { id }, include: [{ model: ProductModel, paranoid: false, as: 'Products' }] })`,
    diff: `--- a/routes/basket.ts
+++ b/routes/basket.ts
@@ -16,6 +16,11 @@
   return async (req: Request, res: Response, next: NextFunction) => {
     try {
       const id = req.params.id
+      const user = security.authenticatedUsers.from(req)
+      if (!user || String(user.bid) !== String(id)) {
+        res.status(403).json({ error: 'Not your basket' })
+        return
+      }
       const basket = await BasketModel.findOne({ where: { id }, include: [{ model: ProductModel, paranoid: false, as: 'Products' }] })
       /* jshint eqeqeq:false */
       challengeUtils.solveIf(challenges.basketAccessChallenge, () => {
`,
    why: 'The route now checks that the basket id in the URL is the basket the session was issued for, so a login only ever opens its own basket.',
  },
  {
    patch: 'change-password',
    title: 'Change password: current password required',
    file: 'routes/changePassword.ts',
    lines: [39, 42],
    vulnerable: `    if (currentPassword && security.hash(currentPassword) !== loggedInUser.data.password) {
      res.status(401).send(res.__('Current password is not correct.'))
      return
    }`,
    diff: `--- a/routes/changePassword.ts
+++ b/routes/changePassword.ts
@@ -36,7 +36,7 @@
       return
     }

-    if (currentPassword && security.hash(currentPassword) !== loggedInUser.data.password) {
+    if (!currentPassword || security.hash(currentPassword) !== loggedInUser.data.password) {
       res.status(401).send(res.__('Current password is not correct.'))
       return
     }
`,
    why: 'A missing current password used to skip the check entirely; now it fails it, so a session alone (stolen or forged) can no longer set a new password.',
  },
  {
    patch: 'token-verify',
    title: 'Tokens: accept RS256 only',
    file: 'lib/insecurity.ts',
    lines: [52, 55],
    vulnerable: `export const isAuthorized = () => expressJwt(({ secret: publicKey }) as any)
export const denyAll = () => expressJwt({ secret: '' + Math.random() } as any)
export const authorize = (user = {}) => jwt.sign(user, privateKey, { expiresIn: '6h', algorithm: 'RS256' })
export const verify = (token: string) => token ? (jws.verify as ((token: string, secret: string) => boolean))(token, publicKey) : false`,
    diff: `--- a/lib/insecurity.ts
+++ b/lib/insecurity.ts
@@ -49,10 +49,10 @@
   return str
 }

-export const isAuthorized = () => expressJwt(({ secret: publicKey }) as any)
-export const denyAll = () => expressJwt({ secret: '' + Math.random() } as any)
+export const isAuthorized = () => expressJwt({ secret: publicKey, algorithms: ['RS256'] })
+export const denyAll = () => expressJwt({ secret: '' + Math.random(), algorithms: ['RS256'] })
 export const authorize = (user = {}) => jwt.sign(user, privateKey, { expiresIn: '6h', algorithm: 'RS256' })
-export const verify = (token: string) => token ? (jws.verify as ((token: string, secret: string) => boolean))(token, publicKey) : false
+export const verify = (token: string) => token ? jws.verify(token, 'RS256', publicKey) : false
 export const decode = (token: string) => { return jws.decode(token)?.payload }

--- a/package.json
+++ b/package.json
@@ -106,7 +106,7 @@
-    "express-jwt": "0.1.3",
+    "express-jwt": "^6.1.2",
@@ -120,7 +120,7 @@
-    "jsonwebtoken": "0.4.0",
+    "jsonwebtoken": "^9.0.2",
`,
    why: 'The old libraries let the token\'s own header choose the algorithm (including none), so the server now pins verification to RS256 with its own public key (express-jwt 6 refuses to run without an algorithms list) and a token the shop did not sign is rejected.',
  },
  {
    patch: 'product-update',
    title: 'Products: writes need an admin',
    file: 'server.ts',
    lines: [401, 403],
    vulnerable: `  app.post('/api/Products', security.isAuthorized())
  // app.put('/api/Products/:id', security.isAuthorized())
  app.delete('/api/Products/:id', security.denyAll())`,
    diff: `--- a/lib/insecurity.ts
+++ b/lib/insecurity.ts
@@ -152,6 +152,16 @@
   return hmac.update(email + roles.deluxe).digest('hex')
 }

+export const isAdmin = () => {
+  return (req: Request, res: Response, next: NextFunction) => {
+    const decodedToken = verify(utils.jwtFrom(req)) && decode(utils.jwtFrom(req))
+    if (decodedToken?.data?.role === roles.admin) {
+      next()
+    } else {
+      res.status(403).json({ error: 'Malicious activity detected' })
+    }
+  }
+}
+
 export const isAccounting = () => {
   return (req: Request, res: Response, next: NextFunction) => {
     const decodedToken = verify(utils.jwtFrom(req)) && decode(utils.jwtFrom(req))
--- a/server.ts
+++ b/server.ts
@@ -399,6 +399,6 @@
   /* Products: Only GET is allowed in order to view products */
-  app.post('/api/Products', security.isAuthorized())
-  // app.put('/api/Products/:id', security.isAuthorized())
+  app.post('/api/Products', security.isAdmin())
+  app.put('/api/Products/:id', security.isAdmin())
   app.delete('/api/Products/:id', security.denyAll())
`,
    why: 'The guard on product updates was commented out, so anyone could rewrite a product; the route now requires a valid token whose role is admin before the generated REST handler runs.',
  },
  {
    patch: 'users-access',
    title: 'User list: admins only',
    file: 'server.ts',
    lines: [395, 397],
    vulnerable: `  app.get('/api/Users', security.isAuthorized())
  app.route('/api/Users/:id')
    .get(security.isAuthorized())`,
    diff: `--- a/server.ts
+++ b/server.ts
@@ -393,7 +393,7 @@
   /* Users: Only POST is allowed in order to register a new user */
-  app.get('/api/Users', security.isAuthorized())
+  app.get('/api/Users', security.isAdmin())
   app.route('/api/Users/:id')
-    .get(security.isAuthorized())
+    .get(security.isAdmin())
     .put(security.denyAll())
     .delete(security.denyAll())
`,
    why: 'Any logged-in session could list every account; with the same admin check as the product routes (see the product-update patch), only an admin token can read the Users table through the API.',
  },
];

export const PATCH_BY_ID: Readonly<Record<Patch, PatchEntry>> = Object.fromEntries(PATCHES.map((p) => [p.patch, p])) as Record<Patch, PatchEntry>;
