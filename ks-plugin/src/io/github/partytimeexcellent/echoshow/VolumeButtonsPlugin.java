// SPDX-License-Identifier: MIT
package io.github.partytimeexcellent.echoshow;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import me.jxl.kiosk.plugins.KioskPlugin;
import me.jxl.kiosk.plugins.PluginHost;

/**
 * Hardware volume buttons for the Echo Show Dashboard.
 *
 * KS reports every press as device.key, and with Kiosk > Disable volume buttons on it no longer
 * changes the volume itself. A press steps the channel that fits the moment: the assistant's
 * share while a voice reply plays, else the device (master) or media volume. Holding a button
 * repeats, faster the longer it's held. Levels are read once and then tracked locally, so a
 * held button costs one setVolume per step; a volume change from elsewhere (HA, the dashboard
 * slider) drops the cached levels and the next press reads again.
 */
public final class VolumeButtonsPlugin implements KioskPlugin {
    static final String DEVICE = "master", MEDIA = "media", ASSISTANT = "assistant";
    /** A voice reply often ends just before the press that meant to turn it down. */
    static final long VOICE_GRACE_MS = 4000;
    /** device.volume events this soon after our own setVolume are our own echo. */
    static final long OWN_ECHO_MS = 1500;
    /** Stay under KS's limits: 8 pending callbacks, 20 commands a second. */
    static final int MAX_PENDING = 6, MAX_PER_SECOND = 16;

    private PluginHost host;
    private ScheduledExecutorService timer;
    private ScheduledFuture<?> hideTask;

    private String normal = DEVICE;
    private boolean voiceReply = true, faster = true, showLevel;
    private double step = 7;

    private final Map<String, Double> level = new HashMap<>();
    private final ArrayDeque<Long> sent = new ArrayDeque<>();
    private int pending;
    private String reading;          // channel with a getVolume in flight
    private int queued;              // steps pressed while that read is in flight
    private String queuedFor;        // the channel those steps belong to
    private long lastSet = -OWN_ECHO_MS;
    private boolean voiceActive;
    private long voiceEnded = Long.MIN_VALUE / 2;
    private String heldKey, heldChannel;
    private long holdStart, lastStep;
    private Double unmuteTo;
    private boolean windowShown;

    /** Milliseconds on a monotonic clock. Tests replace it. */
    LongSupplier clock = () -> System.nanoTime() / 1000000L;
    long now() { return clock.getAsLong(); }

    @Override
    public synchronized void start(PluginHost host, Map<String, Object> settings) {
        this.host = host;
        configure(settings);
        timer = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "echo-volume-buttons");
            thread.setDaemon(true);
            return thread;
        });
        try {
            host.subscribe("device.key");
            host.subscribe("device.volume");
            host.subscribe("voice.interaction");
            host.status("Ready. Turn on Kiosk > Disable volume buttons so the system doesn't change the volume too.", false);
        } catch (RuntimeException error) {
            // An older KS doesn't know device.key; say so instead of failing the whole plugin.
            host.status("This needs Kiosk Satellite 2026.10.9 or newer (" + error.getMessage() + ").", true);
        }
    }

    @Override
    public synchronized void configure(Map<String, Object> settings) {
        normal = "Media volume".equals(settings.get("buttons")) ? MEDIA : DEVICE;
        voiceReply = !Boolean.FALSE.equals(settings.get("voiceReply"));
        faster = !Boolean.FALSE.equals(settings.get("faster"));
        showLevel = Boolean.TRUE.equals(settings.get("showLevel"));
        Object s = settings.get("step");
        step = s instanceof Number ? Math.max(1, Math.min(20, ((Number) s).doubleValue())) : 7;
        if (!showLevel) hideNow();
    }

    @Override
    public void execute(String command, Map<String, Object> arguments) {}

    @Override
    public synchronized void onEvent(String event, Map<String, Object> payload) {
        if (host == null) return;
        if ("ks.device.key".equals(event)) onKey(payload);
        else if ("ks.voice.interaction".equals(event)) {
            boolean active = Boolean.TRUE.equals(payload.get("active"));
            if (voiceActive && !active) voiceEnded = now();
            voiceActive = active;
        } else if ("ks.device.volume".equals(event)) {
            // Someone else changed a level: read it again on the next press.
            if (now() - lastSet > OWN_ECHO_MS && reading == null) level.clear();
        }
    }

    @Override
    public synchronized void stop() {
        host = null;
        if (timer != null) timer.shutdownNow();
        timer = null;
        hideTask = null;
        windowShown = false;
    }

    // ---------- buttons ----------

    private void onKey(Map<String, Object> payload) {
        Object key = payload.get("key");
        boolean down = "down".equals(payload.get("action"));
        int repeat = payload.get("repeat") instanceof Number ? ((Number) payload.get("repeat")).intValue() : 0;
        if ("VOLUME_MUTE".equals(key)) {
            if (down && repeat == 0) toggleMute();
            return;
        }
        int dir = "VOLUME_UP".equals(key) ? 1 : "VOLUME_DOWN".equals(key) ? -1 : 0;
        if (dir == 0) return;
        long t = now();
        if (!down) {
            if (key.equals(heldKey)) heldKey = null;
            return;
        }
        if (repeat == 0 || !key.equals(heldKey)) {
            // A new press picks its channel; a held button keeps it even if the reply ends.
            heldKey = (String) key;
            heldChannel = target(t);
            holdStart = t;
            lastStep = t;
            press(heldChannel, dir);
        } else if (t - lastStep >= interval(t - holdStart)) {
            lastStep = t;
            press(heldChannel, dir);
        }
    }

    String target(long t) {
        if (voiceReply && (voiceActive || t - voiceEnded < VOICE_GRACE_MS)) return ASSISTANT;
        return normal;
    }

    long interval(long held) {
        if (!faster || held < 800) return 200;
        return held < 1600 ? 110 : 60;
    }

    private void press(String channel, int dir) {
        unmuteTo = null;
        Double current = level.get(channel);
        if (current != null) {
            set(channel, current + dir * step);
            return;
        }
        if (channel.equals(reading)) { queued += dir; return; }
        queued = dir;
        queuedFor = channel;
        read(channel);
    }

    private void toggleMute() {
        Double current = level.get(DEVICE);
        if (unmuteTo != null) {
            Double to = unmuteTo;
            unmuteTo = null;
            set(DEVICE, to);
        } else if (current != null && current > 0) {
            set(DEVICE, 0);
            unmuteTo = current;
        } else if (current == null && reading == null) {
            reading = DEVICE;
            query(DEVICE, () -> { Double v = level.get(DEVICE); if (v != null && v > 0) { set(DEVICE, 0); unmuteTo = v; } });
        }
    }

    // ---------- KS commands ----------

    private boolean canSend() {
        long t = now();
        while (!sent.isEmpty() && t - sent.peekFirst() >= 1000) sent.removeFirst();
        if (pending >= MAX_PENDING || sent.size() >= MAX_PER_SECOND) return false;
        sent.addLast(t);
        return true;
    }

    private void read(String channel) {
        reading = channel;
        query(channel, () -> {
            if (!channel.equals(queuedFor)) return;
            int q = queued;
            queued = 0;
            Double v = level.get(channel);
            if (q != 0 && v != null) set(channel, v + q * step);
        });
    }

    private void query(String channel, Runnable then) {
        if (!canSend()) { reading = null; queued = 0; return; }
        Map<String, Object> args = new HashMap<>();
        args.put("channel", channel);
        pending++;
        final PluginHost h = host;
        h.executeCommand("getVolume", args, (ok, data, error) -> {
            synchronized (VolumeButtonsPlugin.this) {
                pending--;
                if (host != h) return;
                if (channel.equals(reading)) reading = null;
                if (!ok || !(data instanceof Number)) {
                    queued = 0;
                    host.status("Couldn't read the " + label(channel).toLowerCase() + ": " + error, true);
                    return;
                }
                level.put(channel, ((Number) data).doubleValue());
                then.run();
            }
        });
    }

    private void set(String channel, double value) {
        final long percent = Math.round(Math.max(0, Math.min(100, value)));
        Double before = level.get(channel);
        if (before != null && Math.round(before) == percent) { show(channel, percent); return; }   // already at 0 or 100
        if (!canSend()) return;   // dropped; the next repeat tries again from the same level
        level.put(channel, (double) percent);
        lastSet = now();
        Map<String, Object> args = new HashMap<>();
        args.put("channel", channel);
        args.put("percent", String.valueOf(percent));   // KS wants a string
        pending++;
        final PluginHost h = host;
        h.executeCommand("setVolume", args, (ok, data, error) -> {
            synchronized (VolumeButtonsPlugin.this) {
                pending--;
                if (host != h || ok) return;
                level.remove(channel);
                host.status("Couldn't set the " + label(channel).toLowerCase() + ": " + error, true);
            }
        });
        show(channel, percent);
    }

    // ---------- feedback ----------

    static String label(String channel) {
        return ASSISTANT.equals(channel) ? "Assistant volume" : MEDIA.equals(channel) ? "Media volume" : "Device volume";
    }

    static String bar(long percent) {
        int filled = (int) Math.round(percent / 10.0);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < 10; i++) b.append(i < filled ? '▰' : '▱');
        return b.toString();
    }

    private void show(String channel, long percent) {
        host.status(label(channel) + " " + percent + "%", false);
        if (!showLevel || timer == null) return;
        host.showWindow(label(channel), bar(percent) + "  " + percent + "%", "");
        windowShown = true;
        if (hideTask != null) hideTask.cancel(false);
        hideTask = timer.schedule(this::hideLater, 1500, TimeUnit.MILLISECONDS);
    }

    private synchronized void hideLater() {
        if (host != null && windowShown) { host.hideWindow(); windowShown = false; }
    }

    private void hideNow() {
        if (hideTask != null) hideTask.cancel(false);
        hideTask = null;
        if (host != null && windowShown) host.hideWindow();
        windowShown = false;
    }

    // Visible for tests.
    synchronized Double cached(String channel) { return level.get(channel); }
    synchronized int pending() { return pending; }
}
