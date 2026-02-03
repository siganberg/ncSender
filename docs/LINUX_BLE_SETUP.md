# Linux BLE Pendant Setup

ncSender uses Bluetooth Low Energy (BLE) to communicate with the ncSender pendant. On Linux, this requires additional permissions to access raw Bluetooth sockets.

## Quick Setup

### For Installed App (deb package)

After installing ncSender via the deb package, run:

```bash
sudo setcap 'cap_net_raw,cap_net_admin=eip' /opt/ncSender/ncsender
```

### For Development (running from source)

When running ncSender from source with `npm run server:dev`:

```bash
sudo setcap 'cap_net_raw,cap_net_admin=eip' $(which node)
```

## Verify Setup

To verify the capabilities are set correctly:

```bash
# For installed app
getcap /opt/ncSender/ncsender

# For development
getcap $(which node)
```

You should see output like:
```
/opt/ncSender/ncsender cap_net_admin,cap_net_raw=eip
```

## Troubleshooting

### "Permission denied" or BLE not working

1. Ensure capabilities are set (see Quick Setup above)
2. Ensure your user is in the `bluetooth` group:
   ```bash
   sudo usermod -a -G bluetooth $USER
   ```
   Log out and back in for group changes to take effect.

### Pendant not discovered

1. Ensure Bluetooth is powered on:
   ```bash
   bluetoothctl power on
   ```
2. Ensure the pendant is advertising (LED should be blinking)
3. Check that no other device is connected to the pendant

### After system updates

System updates may reset capabilities. Re-run the `setcap` command after updating.
