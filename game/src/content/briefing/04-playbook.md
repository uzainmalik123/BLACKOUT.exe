# Incident response playbook

Our playbook follows the six steps most security teams use (SANS, NIST SP 800-61). Under pressure, come back to this page.

## 1. Preparation (you're doing it now)
Know the system, the admins and what normal looks like. Know where the logs are.

## 2. Identification: is this real, and how far did it get?
- Read the logs before you touch anything. Find **who**, **what**, **since when**.
- Check the accounts: any new admins? Any password changes nobody asked for?
- Check the uploads for files that shouldn't be there.
- Look up suspicious addresses **passively**. Don't contact the attacker's machines: that tells him you've seen him.
- Once you're sure it's a breach, **escalate to the incident lead**.

## 3. Containment: stop it spreading, at an acceptable cost
- **Snapshot the evidence before you change anything.** Once you delete or restore, it's gone.
- Every containment step costs something: blocking an address is cheap but easy to dodge; switching a feature off hurts customers; taking the whole site offline stops everything, including the business.
- Prefer closing **the hole he's using** over chasing **the address he's using**.
- Logging everyone out too early, before you know all his footholds, warns him and changes nothing.

## 4. Eradication: remove everything he left behind
- Attackers leave ways back in: extra accounts, changed passwords, planted files, forged keys.
- **Find all of them before you declare victory.** Miss one and he walks back in.
- A firewall rule is a bandage; a code fix closes the hole.

## 5. Recovery: bring the business back safely
- Restore from a backup taken **before** he got in, or you restore him too.
- Bring features back only once the hole behind them is fixed.

## 6. Lessons learned
- Write down what happened, when you noticed, and what you'd do differently.

## Legal
If customer data was taken, **legal and the affected customers must be notified within 72 hours** of confirming the breach (GDPR Art. 33). Tell legal as soon as you're sure, not before.
