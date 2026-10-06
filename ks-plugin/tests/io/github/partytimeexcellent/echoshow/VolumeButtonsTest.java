// SPDX-License-Identifier: MIT
package io.github.partytimeexcellent.echoshow;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import me.jxl.kiosk.plugins.PluginHost;

/** Drives the plugin against a fake KS host that answers commands when told to. */
public final class VolumeButtonsTest {
    static final class Call {
        final String command; final Map<String, Object> args; final PluginHost.CommandCallback callback;
        Call(String command, Map<String, Object> args, PluginHost.CommandCallback callback) { this.command = command; this.args = args; this.callback = callback; }
        public String toString() { return command + args; }
    }

    static class Host implements PluginHost {
        final List<Call> calls = new ArrayList<>();
        final List<Call> waiting = new ArrayList<>();
        final Set<String> subscriptions = new HashSet<>();
        final Map<String, Double> levels = new HashMap<>();
        boolean auto = true;
        String status, window;
        boolean statusError, visible;
        Host() { levels.put("master", 40.0); levels.put("media", 80.0); levels.put("assistant", 50.0); }
        public void executeCommand(String command, Map<String, Object> args, CommandCallback callback) {
            assert args.size() <= 2;
            for (Object v : args.values()) assert v instanceof String || v instanceof Boolean : "argument types";
            Call c = new Call(command, new HashMap<>(args), callback);
            calls.add(c);
            if (auto) answer(c); else waiting.add(c);
        }
        void answer(Call c) {
            String ch = (String) c.args.get("channel");
            if ("getVolume".equals(c.command)) c.callback.onResult(true, levels.get(ch), null);
            else { levels.put(ch, Double.parseDouble((String) c.args.get("percent"))); c.callback.onResult(true, null, null); }
        }
        void flush() { List<Call> w = new ArrayList<>(waiting); waiting.clear(); for (Call c : w) answer(c); }
        public void subscribe(String event) { subscriptions.add(event); }
        public void unsubscribe(String event) { subscriptions.remove(event); }
        public void showWindow(String title, String message, String button) { window = title + ": " + message; visible = true; assert button.isEmpty(); }
        public void hideWindow() { visible = false; }
        public void log(String message) {}
        public void status(String message, boolean error) { status = message; statusError = error; }
        long count(String command) { return calls.stream().filter(c -> c.command.equals(command)).count(); }
        Call last() { return calls.get(calls.size() - 1); }
    }

    static long t;
    static VolumeButtonsPlugin plugin;
    static Host host;

    static Map<String, Object> settings(Object... kv) {
        Map<String, Object> s = new HashMap<>();
        s.put("buttons", "Device volume"); s.put("voiceReply", true); s.put("step", 7.0); s.put("faster", true); s.put("showLevel", false);
        for (int i = 0; i < kv.length; i += 2) s.put((String) kv[i], kv[i + 1]);
        return s;
    }

    static void fresh(Map<String, Object> s) throws Exception {
        if (plugin != null) plugin.stop();
        t = 100000;
        host = new Host();
        plugin = new VolumeButtonsPlugin();
        plugin.clock = () -> t;
        plugin.start(host, s);
    }

    static void key(String key, String action, int repeat) throws Exception {
        Map<String, Object> p = new HashMap<>();
        p.put("key", key); p.put("action", action); p.put("repeat", repeat); p.put("code", 24); p.put("scanCode", 115); p.put("time", "2026-10-06T00:00:00Z");
        plugin.onEvent("ks.device.key", p);
    }

    static void tap(String key) throws Exception { key(key, "down", 0); t += 80; key(key, "up", 0); t += 300; }

    static void voice(boolean active) throws Exception {
        Map<String, Object> p = new HashMap<>();
        p.put("active", active); p.put("source", "page");
        plugin.onEvent("ks.voice.interaction", p);
    }

    static void volumeEvent() throws Exception { plugin.onEvent("ks.device.volume", new HashMap<>()); }

    public static void main(String[] args) throws Exception {
        // Subscribes to what it needs.
        fresh(settings());
        assert host.subscriptions.contains("device.key") && host.subscriptions.contains("voice.interaction") && host.subscriptions.contains("device.volume");
        assert !host.statusError;

        // First press reads once, then sets; later presses use the tracked level.
        tap("VOLUME_UP");
        assert host.count("getVolume") == 1 : host.calls;
        assert host.levels.get("master") == 47.0 : host.levels;
        assert "master".equals(host.last().args.get("channel"));
        assert "47".equals(host.last().args.get("percent")) : "percent is a whole-number string";
        tap("VOLUME_UP");
        tap("VOLUME_DOWN");
        tap("VOLUME_DOWN");
        tap("VOLUME_DOWN");
        assert host.count("getVolume") == 1;
        assert host.levels.get("master") == 33.0 : host.levels;
        assert host.status.equals("Device volume 33%") : host.status;

        // Our own device.volume echo keeps the cache; a later outside change drops it.
        volumeEvent();
        tap("VOLUME_UP");
        assert host.count("getVolume") == 1;
        t += 5000;
        host.levels.put("master", 70.0);   // changed from the dashboard slider
        volumeEvent();
        tap("VOLUME_UP");
        assert host.count("getVolume") == 2;
        assert host.levels.get("master") == 77.0 : host.levels;

        // Clamped at the ends without extra commands.
        fresh(settings());
        host.levels.put("master", 96.0);
        tap("VOLUME_UP");
        long sets = host.count("setVolume");
        tap("VOLUME_UP");
        assert host.levels.get("master") == 100.0;
        assert host.count("setVolume") == sets : "no command once at 100";
        assert host.status.equals("Device volume 100%");

        // During a voice reply, and shortly after, the assistant volume moves instead.
        fresh(settings());
        voice(true);
        tap("VOLUME_DOWN");
        assert host.levels.get("assistant") == 43.0 && host.levels.get("master") == 40.0 : host.levels;
        voice(false);
        t += 2000;
        tap("VOLUME_DOWN");
        assert host.levels.get("assistant") == 36.0 : host.levels;
        t += 5000;
        tap("VOLUME_DOWN");
        assert host.levels.get("master") == 33.0 && host.levels.get("assistant") == 36.0 : host.levels;

        // ...unless that's turned off.
        fresh(settings("voiceReply", false));
        voice(true);
        tap("VOLUME_UP");
        assert host.levels.get("master") == 47.0 && host.levels.get("assistant") == 50.0;

        // A held button keeps its channel when the reply ends mid-hold.
        fresh(settings());
        voice(true);
        key("VOLUME_UP", "down", 0);
        voice(false);
        for (int r = 1; r <= 10; r++) { t += 50; key("VOLUME_UP", "down", r); }
        key("VOLUME_UP", "up", 0);
        assert host.levels.get("master") == 40.0 : "device untouched " + host.levels;
        assert host.levels.get("assistant") > 50.0;

        // Media volume setting.
        fresh(settings("buttons", "Media volume", "step", 5.0));
        tap("VOLUME_DOWN");
        assert host.levels.get("media") == 75.0 && host.levels.get("master") == 40.0 : host.levels;

        // Holding speeds up, and stays under KS's command limits.
        fresh(settings("step", 1.0));
        host.levels.put("master", 0.0);
        key("VOLUME_UP", "down", 0);
        int stepsFirstSecond = 0, stepsThirdSecond = 0;
        long start = t;
        for (int r = 1; t - start < 3000; r++) {
            t += 50;
            double before = host.levels.get("master");
            key("VOLUME_UP", "down", r);
            if (host.levels.get("master") > before) {
                if (t - start < 1000) stepsFirstSecond++;
                else if (t - start >= 2000) stepsThirdSecond++;
            }
        }
        key("VOLUME_UP", "up", 0);
        assert stepsThirdSecond >= stepsFirstSecond * 2 : stepsFirstSecond + " then " + stepsThirdSecond;
        assert stepsThirdSecond <= 16 : "rate " + stepsThirdSecond;
        // Every rolling second stays at or under 16 commands.
        fresh(settings("step", 1.0));
        host.levels.put("master", 0.0);
        List<Long> times = new ArrayList<>();
        key("VOLUME_UP", "down", 0);
        for (int r = 1; r < 200; r++) {
            t += 20;   // faster repeats than any real keyboard
            int before = host.calls.size();
            key("VOLUME_UP", "down", r);
            if (host.calls.size() > before) times.add(t);
        }
        for (int i = 16; i < times.size(); i++) assert times.get(i) - times.get(i - 16) >= 1000 : "more than 16 in a second";

        // Slow KS: presses during the first read are applied when it answers, and pending stays bounded.
        fresh(settings());
        host.auto = false;
        tap("VOLUME_UP");
        tap("VOLUME_UP");
        tap("VOLUME_UP");
        assert host.count("getVolume") == 1 && host.count("setVolume") == 0;
        host.flush();   // the read, which sends one set for all three presses
        assert host.count("setVolume") == 1 && "61".equals(host.last().args.get("percent")) : host.calls;
        host.flush();
        for (int i = 0; i < 20; i++) tap("VOLUME_DOWN");
        assert plugin.pending() <= VolumeButtonsPlugin.MAX_PENDING : "pending " + plugin.pending();
        host.flush();
        assert plugin.pending() == 0;

        // A failed set drops the cached level and reports it.
        fresh(settings());
        tap("VOLUME_UP");
        host.auto = false;
        tap("VOLUME_UP");
        host.waiting.get(0).callback.onResult(false, null, "Volume unavailable");
        host.waiting.clear();
        assert host.statusError && host.status.contains("Volume unavailable");
        assert plugin.cached("master") == null;

        // Mute remembers the level.
        fresh(settings());
        key("VOLUME_MUTE", "down", 0);
        assert host.levels.get("master") == 0.0;
        key("VOLUME_MUTE", "down", 0);
        assert host.levels.get("master") == 40.0;

        // Other keys are ignored.
        fresh(settings());
        tap("DPAD_CENTER");
        tap("MEDIA_PLAY_PAUSE");
        assert host.calls.isEmpty();

        // The optional window shows the level.
        fresh(settings("showLevel", true));
        tap("VOLUME_UP");
        assert host.visible && host.window.equals("Device volume: ▰▰▰▰▰▱▱▱▱▱  47%") : host.window;
        plugin.configure(settings("showLevel", false));
        assert !host.visible;

        // An old KS without device.key reports it instead of failing.
        plugin.stop();
        Host old = new Host() { public void subscribe(String event) { if (event.equals("device.key")) throw new IllegalArgumentException("Unknown event"); } };
        VolumeButtonsPlugin p2 = new VolumeButtonsPlugin();
        p2.start(old, settings());
        assert old.statusError && old.status.contains("2026.10.9");
        p2.stop();

        // Stopped: events and late callbacks do nothing.
        fresh(settings());
        host.auto = false;
        tap("VOLUME_UP");
        plugin.stop();
        host.flush();
        tap("VOLUME_UP");
        assert host.count("getVolume") == 1 && host.count("setVolume") == 0;

        System.out.println("VolumeButtonsTest passed");
    }
}
