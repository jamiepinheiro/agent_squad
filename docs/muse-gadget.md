# Muse Gadget (experimental)

Pair with the Muse phone app on a Raspberry Pi, then move that pairing to Agent
Squad on your Mac. The Mac uses an encrypted internet connection after import;
the Pi can stay switched off. WhatsApp remains available separately.

## 1. Pair the Raspberry Pi

Install and pair the [official Muse Linux SDK](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux).
Use your own [Muse SDK token](https://gadgets.muse.ai/settings/sdk-tokens).
In Muse on your phone, enable **Settings → Devices → Developer mode**, then use
**Add Device** and complete pairing with the Pi.

## 2. Transfer over your local network

Keep the Pi and Mac on the same network, with Agent Squad open on the Mac.
No SSH connection or manual credential copying is needed for the transfer.

1. In Agent Squad, open **Add Agents → Muse Gadget** (or **Settings → Muse Gadget**).
2. Click **Receive pairing from Raspberry Pi**, then **Copy Pi command**.
3. Paste that command into a terminal **on the paired Pi** and run it. Enter the
   Pi's sudo password if requested. The Pi needs Python 3, curl, and systemd.
4. Wait for the terminal to say **Pairing saved in Agent Squad**, and for the Mac
   to show **Connected to Muse**. When adding an agent, click **Save Agent**.

The command first reads the official SDK's paired state in `/var/lib/musegadget`.
It then disables and stops `musegadget.service`, and transfers the pairing directly
into Agent Squad. It does not create an export file or print credentials. Agent
Squad validates the pairing with Muse before saving it in macOS Keychain.
Keep the Pi service disabled after migration: only the Mac should rotate this
identity's tokens. You can switch the Pi off after a successful transfer.

The receiver closes after one successful import, cancellation, or ten minutes.
Each command pins its temporary HTTPS server's identity, so credentials are
encrypted even on shared Wi-Fi. This is a one-use setup capability, not an MCP
access token or an OAuth login. Only paste the command copied from your own app.
A transfer already being checked can finish after the ten-minute window closes.

### Troubleshooting

- **Pi not paired:** finish `sudo musegadget pair` in the official SDK before
  transferring. Enable Developer mode in Muse's device settings.
- **Cannot reach the Mac:** check both devices are on the same network; guest
  Wi-Fi may block communication between devices. Allow Agent Squad's incoming
  connection if macOS asks. Turn off a VPN that routes local traffic elsewhere.
- **Expired command:** click **Receive pairing from Raspberry Pi** again and
  copy the new command.
- **Import fails:** check Agent Squad's status. The Pi service stays stopped and
  its original pairing files remain intact. Do not restart it after the Mac has
  accepted the pairing. If credentials rotated during a failed transfer, pair
  again on the Pi instead of reusing stale credentials.
- **Custom SDK service:** stop any manually launched SDK instance before running
  the command. For a custom state directory, use the file export below.

## File import fallback

Choose **Setup instructions** to open the bundled MuseSetup folder's guide.
The folder also contains `export-pairing.py`. Run it on the Pi after stopping
its Muse service:

```sh
sudo systemctl disable --now musegadget.service
sudo python3 export-pairing.py --output ~/muse-pairing.json
sudo chown "$(id -u):$(id -g)" ~/muse-pairing.json
```

Use `--state-dir` if needed. Privately transfer that file to the Mac, select
**Import from file…**, then delete both transfer copies after successful import.
The exporter refuses to overwrite files or export while the standard service
is running. Never commit the pairing file or send it through email/chat.

Direct Mac Bluetooth pairing has been removed because Muse did not discover the
Mac reliably. Pair once on a Raspberry Pi, then use the Mac's internet connection.

## Replies and sessions

Each Agent Squad session becomes a separate Muse side chat. Agent Squad advertises
one device command, `agent_squad.reply`, and asks Muse to invoke it with the complete
final answer. It does not expose shell or filesystem commands.

A delivery acknowledgement does not complete a task. If Muse only answers in its
app, Agent Squad waits for the callback and eventually reports a timeout. Check
Muse’s side chat before retrying: cancellation stops waiting locally and delivery
failures are never automatically resent. Interrupted tasks cannot resume after
restarting Agent Squad.

## Verification

Noise XX handshake and bidirectional transport encryption have been checked
against the official Python responder.
Pi pairing, credential migration to the Mac, live tasks, and final reply callbacks
have been verified with a Muse account. The LAN transfer has also been verified with real Pi credentials by removing and
re-importing a working connection. Setup does not send a test message.

The native implementation follows Meta’s
[Muse Gadget SDK](https://github.com/facebookincubator/muse-gadget-sdk) at revision
`468e5ba629f988ad107ba472555a8b632faac0d3`. See the library’s `NOTICE` and
`LICENSE-MUSE-SDK` for attribution. Pairing uses its community `confirm_app` mode.
