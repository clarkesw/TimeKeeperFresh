// =============================================================================
// !! CLAUDE: ALWAYS INCREMENT APP_VERSION BEFORE PROVIDING THIS FILE !!
// Current: v1.0.5
// Format:  v1.0.X — bump X by 1 for every change, no exceptions
// Located: const APP_VERSION = 'v1.0.X' just below the imports
// =============================================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, ActivityIndicator,
  Platform, StatusBar, Animated, Easing, RefreshControl, AppState,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const GOAL_HOURS = 5;
const SEED_DAYS = 915;
const SEED_HOURS = 2977.0;
const APP_VERSION = 'v1.0.5';

const TASK_COLUMNS = [
  'Paid Work', 'Java Study', 'Code Practice',
  'Interview Ques.', 'Business Idea', 'Church Work',
];

const DROPBOX_BASIC_AUTH = 'dHNvcmdjZ2Jwb3o4Ynk4OjQ4NGFnazVrb2FnNGZ3aA==';
const DROPBOX_REFRESH    = 'Zi0IllJ2VP0AAAAAAAAAAem1c4B9k2w5uyv6ko-ESPb-N5MWe4u7ph2Bp-RlP2ur';

const CACHE_KEY_ENTRIES = 'tt_entries_today';
const CACHE_KEY_QUEUE   = 'tt_offline_queue';
const CACHE_KEY_TOKEN   = 'tt_dropbox_token';
const CACHE_KEY_ALLTIME = 'tt_alltime';

const { width: SW } = Dimensions.get('window');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Entry {
  type: 'START' | 'END';
  timestamp: Date;
  tasks?: string[];
  note?: string;
}

interface SessionData {
  number: number;
  start: Date;
  end: Date | null;
  duration: number;
  tasks: string[];
  active?: boolean;
}

interface DayTotal { date: string; total_ms: number; is_today: boolean; }
interface AlltimeStats { days: number; hours: number; }

// ---------------------------------------------------------------------------
// Dropbox helpers
// ---------------------------------------------------------------------------
async function getAccessToken(): Promise<string | null> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY_TOKEN);
    if (cached) {
      const { token, expires } = JSON.parse(cached);
      if (Date.now() < expires - 60000) return token;
    }
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${DROPBOX_BASIC_AUTH}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${DROPBOX_REFRESH}`,
    });
    const data = await res.json();
    if (!data.access_token) return null;
    await AsyncStorage.setItem(CACHE_KEY_TOKEN, JSON.stringify({
      token: data.access_token,
      expires: Date.now() + (data.expires_in || 14400) * 1000,
    }));
    return data.access_token;
  } catch { return null; }
}

function getMonthFilename(date: Date = new Date()): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `time_tracker_${months[date.getMonth()]}_${date.getFullYear()}.csv`;
}

function getMonthPrefix(date: Date = new Date()): string {
  // Returns e.g. "2026-05" to filter rows belonging to this month's file
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

async function downloadCSV(token: string, path: string): Promise<string | null> {
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path }),
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function uploadCSV(token: string, path: string, content: string): Promise<boolean> {
  try {
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', autorename: false, mute: false }),
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });
    return res.ok;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------
const CSV_HEADER = 'Type,Timestamp,Date,Time,Paid Work,Java Study,Code Practice,Interview Ques.,Business Idea,Church Work,Notes,Days Accessed,Total Hours';
const CSV_FIELDS = ['Type','Timestamp','Date','Time','Paid Work','Java Study','Code Practice','Interview Ques.','Business Idea','Church Work','Notes','Days Accessed','Total Hours'];

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] || '').trim(); });
    return row;
  });
}

function rowToLine(row: Record<string, string>): string {
  return CSV_FIELDS.map(f => {
    const v = row[f] || '';
    return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(',');
}

function pad(n: number) { return String(n).padStart(2, '0'); }

function formatTimestamp(d: Date): string {
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function formatTime(d: Date): string {
  const tz = d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || '';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${tz}`;
}

function formatHMS(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatHr(ms: number): string {
  return `${(ms / 3600000).toFixed(1)} Hr`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function calcFileStats(rows: Record<string, string>[]): { days: number; hours: number } {
  const daySet = new Set<string>();
  let totalMs = 0, startTs: Date | null = null;
  for (const row of rows) {
    if (row.Date) daySet.add(row.Date);
    if (row.Type === 'START') { startTs = new Date(row.Timestamp); }
    else if (row.Type === 'END' && startTs) {
      const e = new Date(row.Timestamp);
      if (!isNaN(e.getTime())) totalMs += e.getTime() - startTs.getTime();
      startTs = null;
    }
  }
  return { days: daySet.size, hours: totalMs / 3600000 };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function TimeTracker() {
  const [isRunning, setIsRunning]           = useState(false);
  const [currentStartTime, setCurrentStart] = useState<Date | null>(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [totalTodayMs, setTotalTodayMs]     = useState(0);
  const [entries, setEntries]               = useState<Entry[]>([]);

  const [currentSessionTasks, setCurrentSessionTasks] = useState<Set<string>>(new Set());
  const [todayTaskCounts, setTodayTaskCounts]         = useState<Record<string, number>>({});
  const [todayTaskMs, setTodayTaskMs]                 = useState<Record<string, number>>({});

  const [noteText, setNoteText]           = useState('');
  const [saveStatus, setSaveStatus]       = useState<{ msg: string; ok: boolean } | null>(null);
  const [histogramData, setHistogramData] = useState<DayTotal[]>([]);
  const [alltime, setAlltime]             = useState<AlltimeStats | null>(null);
  const [loading, setLoading]             = useState(true);
  const [syncing, setSyncing]             = useState(false);
  const [refreshing, setRefreshing]       = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thermAnim   = useRef(new Animated.Value(0)).current;

  // Thermometer animation
  useEffect(() => {
    const pct = Math.min(totalTodayMs / (GOAL_HOURS * 3600000), 1);
    Animated.timing(thermAnim, {
      toValue: pct,
      duration: 600,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [totalTodayMs]);

  // Session tick
  useEffect(() => {
    if (isRunning && currentStartTime) {
      intervalRef.current = setInterval(() => {
        setSessionElapsed(Date.now() - currentStartTime.getTime());
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (!isRunning) setSessionElapsed(0);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isRunning, currentStartTime]);

  const recalcFromEntries = useCallback((ents: Entry[]) => {
    let totalMs = 0, start: Date | null = null;
    const counts: Record<string, number> = {};
    const taskMs: Record<string, number> = {};
    for (const e of ents) {
      if (e.type === 'START') { start = e.timestamp; }
      else if (e.type === 'END' && start) {
        const dur = e.timestamp.getTime() - start.getTime();
        totalMs += dur;
        (e.tasks || []).forEach(t => {
          counts[t] = (counts[t] || 0) + 1;
          taskMs[t] = (taskMs[t] || 0) + dur;
        });
        start = null;
      }
    }
    setTotalTodayMs(totalMs);
    setTodayTaskCounts(counts);
    setTodayTaskMs(taskMs);
  }, []);

  const buildSessions = (ents: Entry[], activeStart: Date | null, running: boolean, activeTasks: Set<string>): SessionData[] => {
    const sessions: SessionData[] = [];
    let start: Date | null = null, num = 1;
    for (const e of ents) {
      if (e.type === 'START') { start = e.timestamp; }
      else if (e.type === 'END' && start) {
        sessions.push({ number: num++, start, end: e.timestamp, duration: e.timestamp.getTime() - start.getTime(), tasks: e.tasks || [] });
        start = null;
      }
    }
    if (activeStart && running) {
      sessions.push({ number: num, start: activeStart, end: null, duration: Date.now() - activeStart.getTime(), tasks: Array.from(activeTasks), active: true });
    }
    return sessions;
  };

  // Offline queue flush — merges all queued entries into one upload per file
  const flushQueue = async (token: string) => {
    const raw = await AsyncStorage.getItem(CACHE_KEY_QUEUE);
    if (!raw) return;
    const queue: Array<{ path: string; rows: Record<string, string>[] }> = JSON.parse(raw);
    if (queue.length === 0) { await AsyncStorage.removeItem(CACHE_KEY_QUEUE); return; }

    // Group by path so multiple offline sessions for same file merge correctly
    const byPath: Record<string, Record<string, string>[]> = {};
    for (const item of queue) {
      if (!byPath[item.path]) {
        // Download latest from Dropbox as base, fall back to item rows
        const existing = await downloadCSV(token, item.path);
        byPath[item.path] = existing ? parseCSV(existing) : item.rows;
      } else {
        // Append any new rows not already in the merged set
        const existingTs = new Set(byPath[item.path].map(r => r.Timestamp));
        for (const row of item.rows) {
          if (!existingTs.has(row.Timestamp)) byPath[item.path].push(row);
        }
      }
    }

    const failed: Array<{ path: string; rows: Record<string, string>[] }> = [];
    for (const [path, rows] of Object.entries(byPath)) {
      // Re-stamp totals
      const stats = calcFileStats(rows);
      rows.forEach(r => { r['Days Accessed'] = ''; r['Total Hours'] = ''; });
      const lastEnd = [...rows].reverse().findIndex(r => r.Type === 'END');
      if (lastEnd >= 0) {
        rows[rows.length - 1 - lastEnd]['Days Accessed'] = String(stats.days);
        rows[rows.length - 1 - lastEnd]['Total Hours'] = stats.hours.toFixed(1);
      }
      const content = CSV_HEADER + '\n' + rows.map(rowToLine).join('\n') + '\n';
      const ok = await uploadCSV(token, path, content);
      if (!ok) failed.push({ path, rows });
    }

    await (failed.length === 0
      ? AsyncStorage.removeItem(CACHE_KEY_QUEUE)
      : AsyncStorage.setItem(CACHE_KEY_QUEUE, JSON.stringify(failed)));
  };

  const syncRows = async (rows: Record<string, string>[], path: string) => {
    setSyncing(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('no token');
      await flushQueue(token);
      const content = CSV_HEADER + '\n' + rows.map(rowToLine).join('\n') + '\n';
      const ok = await uploadCSV(token, path, content);
      if (!ok) throw new Error('upload failed');
    } catch {
      const raw = await AsyncStorage.getItem(CACHE_KEY_QUEUE);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push({ path, rows });
      await AsyncStorage.setItem(CACHE_KEY_QUEUE, JSON.stringify(queue));
    } finally { setSyncing(false); }
  };

  // Load today
  const loadToday = useCallback(async () => {
    setLoading(true);
    try {
      const todayStr = formatDate(new Date());
      let allRows: Record<string, string>[] = [];
      const token = await getAccessToken();

      if (token) {
        await flushQueue(token);
        const filename = getMonthFilename();
        const csv = await downloadCSV(token, `/${filename}`);
        if (csv) {
          allRows = parseCSV(csv);
          await AsyncStorage.setItem(CACHE_KEY_ENTRIES, JSON.stringify(allRows));
        } else {
          const cached = await AsyncStorage.getItem(CACHE_KEY_ENTRIES);
          if (cached) {
            const monthPrefix = getMonthPrefix(new Date());
            allRows = (JSON.parse(cached) as Record<string, string>[])
              .filter(r => !r.Date || r.Date.startsWith(monthPrefix));
          }
        }
        loadHistogramData(token, allRows);
        loadAlltimeData(token);
      } else {
        const cached = await AsyncStorage.getItem(CACHE_KEY_ENTRIES);
        if (cached) allRows = JSON.parse(cached);
        const cachedAt = await AsyncStorage.getItem(CACHE_KEY_ALLTIME);
        if (cachedAt) setAlltime(JSON.parse(cachedAt));
      }

      const todayRows = allRows.filter(r => r.Date === todayStr);
      const ents: Entry[] = todayRows
        .filter(r => r.Type === 'START' || r.Type === 'END')
        .map(r => {
          const e: Entry = { type: r.Type as 'START' | 'END', timestamp: new Date(r.Timestamp) };
          if (r.Type === 'END') {
            e.tasks = TASK_COLUMNS.filter(t => r[t]?.toLowerCase() === 'x');
            if (r.Notes) e.note = r.Notes;
          }
          return e;
        });

      setEntries(ents);
      recalcFromEntries(ents);

      if (ents.length > 0 && ents[ents.length - 1].type === 'START') {
        setCurrentStart(ents[ents.length - 1].timestamp);
        setIsRunning(true);
      }
    } catch (e) { console.error('loadToday:', e); }
    finally { setLoading(false); }
  }, [recalcFromEntries]);

  const loadHistogramData = async (token: string, allRows: Record<string, string>[]) => {
    const today = new Date();
    let prevRows: Record<string, string>[] = [];
    const prevDate = new Date(today.getFullYear(), today.getMonth(), 0);
    const prevCsv = await downloadCSV(token, `/TimeBackup/${getMonthFilename(prevDate)}`);
    if (prevCsv) prevRows = parseCSV(prevCsv);
    const combined = [...prevRows, ...allRows];
    const result: DayTotal[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dateStr = formatDate(d);
      const dayRows = combined.filter(r => r.Date === dateStr);
      let totalMs = 0, start: Date | null = null;
      for (const r of dayRows) {
        if (r.Type === 'START') { start = new Date(r.Timestamp); }
        else if (r.Type === 'END' && start) {
          totalMs += new Date(r.Timestamp).getTime() - start.getTime();
          start = null;
        }
      }
      result.push({ date: dateStr, total_ms: totalMs, is_today: i === 0 });
    }
    setHistogramData(result);
  };

  const loadAlltimeData = async (token: string) => {
    try {
      let totalDays = 0, totalHours = 0;
      const curCsv = await downloadCSV(token, `/${getMonthFilename()}`);
      if (curCsv) { const s = calcFileStats(parseCSV(curCsv)); totalDays += s.days; totalHours += s.hours; }
      const now = new Date();
      for (let i = 1; i <= 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const csv = await downloadCSV(token, `/TimeBackup/${getMonthFilename(d)}`);
        if (csv) { const s = calcFileStats(parseCSV(csv)); totalDays += s.days; totalHours += s.hours; }
      }
      const result = { days: totalDays + SEED_DAYS, hours: Math.round((totalHours + SEED_HOURS) * 10) / 10 };
      setAlltime(result);
      await AsyncStorage.setItem(CACHE_KEY_ALLTIME, JSON.stringify(result));
    } catch (e) { console.error('loadAlltime:', e); }
  };

  const saveEntry = async (type: 'START' | 'END', timestamp: Date, tasks: string[], note: string) => {
    const filename = getMonthFilename(timestamp);
    const path = `/${filename}`;
    const token = await getAccessToken();
    let rows: Record<string, string>[] = [];

    // Always read from local cache first — never re-download mid-session
    // This prevents race conditions where a fresh download overwrites in-progress data
    const cached = await AsyncStorage.getItem(CACHE_KEY_ENTRIES);
    if (cached) {
      const allCached: Record<string, string>[] = JSON.parse(cached);
      // Only keep rows belonging to this month's file — prevents cross-month contamination
      const monthPrefix = getMonthPrefix(timestamp);
      rows = allCached.filter(r => !r.Date || r.Date.startsWith(monthPrefix));
    }

    // For START only: try to sync with Dropbox to get latest state from other devices
    if (type === 'START' && token) {
      const csv = await downloadCSV(token, path);
      if (csv) {
        rows = parseCSV(csv);
        await AsyncStorage.setItem(CACHE_KEY_ENTRIES, JSON.stringify(rows));
      }
    }

    if (note) rows = rows.map(r => (r.Notes && note.startsWith(r.Notes)) ? { ...r, Notes: '' } : r);

    const newRow: Record<string, string> = {};
    CSV_FIELDS.forEach(f => newRow[f] = '');
    newRow.Type = type;
    newRow.Timestamp = formatTimestamp(timestamp);
    newRow.Date = formatDate(timestamp);
    newRow.Time = formatTime(timestamp);

    if (type === 'END') {
      tasks.forEach(t => { if (CSV_FIELDS.includes(t)) newRow[t] = 'x'; });
      if (note && !rows.some(r => r.Notes === note)) newRow.Notes = note;
    }

    rows.push(newRow);

    if (type === 'END') {
      const stats = calcFileStats(rows);
      rows.forEach(r => { r['Days Accessed'] = ''; r['Total Hours'] = ''; });
      rows[rows.length - 1]['Days Accessed'] = String(stats.days);
      rows[rows.length - 1]['Total Hours'] = stats.hours.toFixed(1);
    }

    // Save to cache immediately
    await AsyncStorage.setItem(CACHE_KEY_ENTRIES, JSON.stringify(rows));

    // Then sync to Dropbox in background
    syncRows(rows, path);
    showStatus(type === 'START' ? 'Session started!' : 'Session saved!', true);
  };

  const handleStart = async () => {
    const now = new Date();
    const newEntries = [...entries, { type: 'START' as const, timestamp: now }];
    setEntries(newEntries);
    setCurrentStart(now);
    setIsRunning(true);
    setCurrentSessionTasks(new Set());
    setNoteText('');
    await saveEntry('START', now, [], '');
  };

  const handleEnd = async () => {
    const now = new Date();
    const tasksArray = Array.from(currentSessionTasks);
    const sessionDur = currentStartTime ? now.getTime() - currentStartTime.getTime() : 0;
    const isDuplicate = noteText.trim().length > 0 && entries.some(e => e.note === noteText.trim());
    const finalNote = noteText.trim().length > 0 && !isDuplicate ? noteText.trim() : '';
    const newEntry: Entry = { type: 'END', timestamp: now, tasks: tasksArray, note: finalNote || undefined };
    setEntries(prev => [...prev, newEntry]);
    setTodayTaskCounts(prev => { const n = { ...prev }; tasksArray.forEach(t => n[t] = (n[t] || 0) + 1); return n; });
    setTodayTaskMs(prev => { const n = { ...prev }; tasksArray.forEach(t => n[t] = (n[t] || 0) + sessionDur); return n; });
    setTotalTodayMs(prev => prev + sessionDur);
    setIsRunning(false);
    setCurrentStart(null);
    setCurrentSessionTasks(new Set());
    setNoteText('');
    await saveEntry('END', now, tasksArray, finalNote);
    const token = await getAccessToken();
    if (token) loadAlltimeData(token);
  };

  const handleTaskPress = (task: string) => {
    setCurrentSessionTasks(prev => { const n = new Set(prev); n.add(task); return n; });
  };

  const showStatus = (msg: string, ok: boolean) => {
    setSaveStatus({ msg, ok });
    setTimeout(() => setSaveStatus(null), 3000);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadToday();
    setRefreshing(false);
  }, [loadToday]);

  // Flush offline queue whenever app comes back to foreground
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const token = await getAccessToken();
        if (token) {
          const raw = await AsyncStorage.getItem(CACHE_KEY_QUEUE);
          if (raw) {
            setSyncing(true);
            await flushQueue(token);
            setSyncing(false);
          }
        }
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);

  // Derived
  const thermoPct   = Math.min(totalTodayMs / (GOAL_HOURS * 3600000), 1);
  const sessions    = buildSessions(entries, currentStartTime, isRunning, currentSessionTasks);
  const maxHistMs   = Math.max(...(histogramData.length ? histogramData.map(d => d.total_ms) : [0]), GOAL_HOURS * 3600000);
  const tzAbbr      = new Date().toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop() || 'EST';
  const THERM_W     = SW - 32; // full width for horizontal bar

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <ActivityIndicator size="large" color="#667eea" />
        <Text style={s.loadingText}>Loading TimeKeeper...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="white"
            colors={['white']}
          />
        }
      >

        {/* ── Header ── */}
        <View style={s.header}>
          <Text style={s.headerTitle}>⏱ Time Tracker</Text>
          <Text style={s.headerTz}>({tzAbbr})</Text>
          {syncing && <ActivityIndicator size="small" color="rgba(255,255,255,0.7)" style={{ marginLeft: 8 }} />}
        </View>

        {/* ── Horizontal Thermometer ── */}
        <View style={s.thermWrap}>
          <Text style={s.thermLabel}>Daily Goal</Text>
          <View style={s.thermTrack}>
            <Animated.View style={[
              s.thermFill,
              {
                width: thermAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: thermoPct >= 1 ? '#f59e0b' : '#10b981',
              },
            ]} />
            {/* Tick marks at 1h intervals */}
            {[1, 2, 3, 4].map(n => (
              <View key={n} style={[s.thermTick, { left: `${(n / 5) * 100}%` }]}>
                <Text style={s.thermTickLabel}>{n}h</Text>
              </View>
            ))}
          </View>
          <Text style={s.thermPct}>{Math.round(thermoPct * 100)}%</Text>
        </View>

        {/* ── White card ── */}
        <View style={s.card}>

          {/* Current Session */}
          <View style={s.sessionBox}>
            <Text style={s.sessionLabel}>CURRENT SESSION</Text>
            <Text style={[s.sessionTime, isRunning && s.sessionTimeGreen]}>
              {formatHMS(sessionElapsed)}
            </Text>
          </View>

          {/* Buttons */}
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.btn, s.btnStart, isRunning && s.btnDim]} onPress={handleStart} disabled={isRunning}>
              <Text style={s.btnTxt}>START</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btn, s.btnEnd, !isRunning && s.btnDim]} onPress={handleEnd} disabled={!isRunning}>
              <Text style={s.btnTxt}>END</Text>
            </TouchableOpacity>
          </View>

          {saveStatus && (
            <View style={[s.statusBar, saveStatus.ok ? s.statusOk : s.statusErr]}>
              <Text style={s.statusTxt}>{saveStatus.msg}</Text>
            </View>
          )}

          {/* Today's Total */}
          <View style={s.statsBox}>
            <Text style={s.sectionTitle}>Today's Total</Text>
            <Text style={s.totalTime}>{formatHMS(totalTodayMs)}</Text>
          </View>

          {/* Daily Goals */}
          <View style={s.statsBox}>
            <Text style={s.sectionTitle}>Daily Goals</Text>
            {TASK_COLUMNS.map(task => {
              const isActive   = currentSessionTasks.has(task);
              const anyPressed = currentSessionTasks.size > 0;
              const disabled   = !isRunning || isActive || (anyPressed && !isActive);
              const count      = (todayTaskCounts[task] || 0) + (isActive ? 1 : 0);
              const ms         = (todayTaskMs[task] || 0) + (isActive && currentStartTime ? Date.now() - currentStartTime.getTime() : 0);
              return (
                <TouchableOpacity
                  key={task}
                  style={[s.taskBtn, isActive && s.taskBtnActive, disabled && !isActive && s.taskBtnDim]}
                  onPress={() => handleTaskPress(task)}
                  disabled={disabled}
                  activeOpacity={0.75}
                >
                  <Text style={[s.taskBtnTxt, isActive && s.taskBtnTxtActive]}>{task.toUpperCase()}</Text>
                  <View style={s.taskRight}>
                    {count > 0 && <Text style={[s.taskHours, isActive && s.taskHoursActive]}>{formatHr(ms)}</Text>}
                    <View style={[s.badge, count === 0 && s.badgeZero]}>
                      <Text style={s.badgeTxt}>{count}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Notes */}
            <View style={s.notesWrap}>
              <Text style={s.sectionTitle}>Session Notes</Text>
              <TextInput
                style={[s.notesInput, !isRunning && s.notesInputDim]}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Add notes (saved when you press End)..."
                placeholderTextColor="#9ca3af"
                multiline
                maxLength={255}
                editable={isRunning}
              />
              <Text style={s.noteCount}>{noteText.length}/255</Text>
            </View>

            {/* Histogram */}
            <View style={s.histWrap}>
              <Text style={s.sectionTitle}>Last 7 Days</Text>
              <View style={s.histRow}>
                {histogramData.map(day => {
                  const hours    = day.total_ms / 3600000;
                  const heightPct = maxHistMs > 0 ? (day.total_ms / maxHistMs) * 100 : 0;
                  const metGoal  = hours >= GOAL_HOURS;
                  const [y, mo, d] = day.date.split('-').map(Number);
                  const dt       = new Date(y, mo - 1, d);
                  const dayName  = dt.toLocaleDateString('en-US', { weekday: 'short' });
                  const md       = dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
                  const barColor = day.is_today ? '#10b981' : metGoal ? '#f59e0b' : '#667eea';
                  return (
                    <View key={day.date} style={s.histCol}>
                      <View style={s.histBarWrap}>
                        {day.total_ms > 0 && <Text style={s.histVal}>{hours.toFixed(1)}h</Text>}
                        <View style={[s.histBar, { height: `${Math.max(heightPct, 3)}%`, backgroundColor: barColor }]} />
                      </View>
                      <Text style={[s.histLabel, day.is_today && s.histLabelToday]}>{dayName}{'\n'}{md}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Timeline */}
          <View style={s.statsBox}>
            <Text style={s.sectionTitle}>Complete Timeline</Text>
            {sessions.length === 0
              ? <Text style={s.noSessions}>No sessions yet</Text>
              : sessions.slice().reverse().map(session => (
                <View key={session.number} style={[s.sessionCard, session.active && s.sessionCardActive]}>
                  <View style={s.sessionCardRow}>
                    <Text style={s.sessionNum}>Session {session.number}</Text>
                    <Text style={[s.sessionDur, session.active && s.sessionDurGreen]}>{formatHMS(session.duration)}</Text>
                  </View>
                  <View style={s.sessionCardRow}>
                    <Text style={s.timeLabel}><Text style={s.startDot}>Start: </Text>{fmtTime(session.start)}</Text>
                    <Text style={s.timeLabel}><Text style={s.endDot}>End: </Text>{session.end ? fmtTime(session.end) : 'In Progress'}</Text>
                  </View>
                  {session.tasks.length > 0 && (
                    <View style={s.tagRow}>
                      {session.tasks.map(t => (
                        <View key={t} style={s.tag}><Text style={s.tagTxt}>{t}</Text></View>
                      ))}
                    </View>
                  )}
                </View>
              ))
            }
          </View>

          {/* Lifetime */}
          <View style={s.lifetimeBox}>
            <View style={s.lifetimeStat}>
              <Text style={s.lifetimeVal}>{alltime ? alltime.days.toLocaleString() : '—'}</Text>
              <Text style={s.lifetimeLbl}>DAYS ACCESSED</Text>
            </View>
            <View style={s.lifetimeDiv} />
            <View style={s.lifetimeStat}>
              <Text style={s.lifetimeVal}>{alltime ? alltime.hours.toLocaleString() : '—'}</Text>
              <Text style={s.lifetimeLbl}>TOTAL HOURS</Text>
            </View>
          </View>

          {/* Version */}
          <Text style={s.version}>{APP_VERSION}</Text>

        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#667eea' },

  loadingWrap: { flex: 1, backgroundColor: '#667eea', justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { color: 'white', fontSize: 16, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 12,
  },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: 'white' },
  headerTz: { fontSize: 15, color: 'rgba(255,255,255,0.8)', fontWeight: '500' },

  // Horizontal thermometer
  thermWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  thermLabel: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: 0.5, width: 44 },
  thermTrack: {
    flex: 1, height: 18, backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 9, overflow: 'visible', position: 'relative',
  },
  thermFill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 9 },
  thermTick: { position: 'absolute', top: -16, alignItems: 'center' },
  thermTickLabel: { fontSize: 9, color: 'rgba(255,255,255,0.7)', fontWeight: '600' },
  thermPct: { fontSize: 13, fontWeight: '700', color: 'white', width: 36, textAlign: 'right' },

  // Card
  card: { backgroundColor: 'white', borderRadius: 20, padding: 16, gap: 14 },

  // Session
  sessionBox: { backgroundColor: '#f3f4f6', borderRadius: 12, padding: 14, alignItems: 'center' },
  sessionLabel: { fontSize: 11, fontWeight: '700', color: '#9ca3af', letterSpacing: 1.5, marginBottom: 6 },
  sessionTime: { fontSize: 38, fontWeight: '700', color: '#667eea', letterSpacing: 2 },
  sessionTimeGreen: { color: '#10b981' },

  // Buttons
  btnRow: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnStart: { backgroundColor: '#10b981' },
  btnEnd: { backgroundColor: '#ef4444' },
  btnDim: { opacity: 0.45 },
  btnTxt: { color: 'white', fontSize: 16, fontWeight: '700', letterSpacing: 1.5 },

  // Status
  statusBar: { borderRadius: 8, padding: 10, alignItems: 'center' },
  statusOk: { backgroundColor: '#d1fae5' },
  statusErr: { backgroundColor: '#fee2e2' },
  statusTxt: { fontSize: 13, fontWeight: '600', color: '#065f46' },

  // Stats boxes
  statsBox: { backgroundColor: '#f3f4f6', borderRadius: 12, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#374151' },
  totalTime: { fontSize: 32, fontWeight: '700', color: '#667eea', textAlign: 'center' },

  // Task buttons
  taskBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'white', borderWidth: 2, borderColor: '#e5e7eb',
    borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12,
  },
  taskBtnActive: { backgroundColor: '#ede9fe', borderColor: '#667eea' },
  taskBtnDim: { opacity: 0.5 },
  taskBtnTxt: { flex: 1, fontSize: 13, fontWeight: '700', color: '#374151', letterSpacing: 0.5 },
  taskBtnTxtActive: { color: '#4f46e5' },
  taskRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskHours: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  taskHoursActive: { color: '#4f46e5' },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: '#667eea', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeZero: { backgroundColor: '#d1d5db' },
  badgeTxt: { color: 'white', fontSize: 12, fontWeight: '700' },

  // Notes
  notesWrap: { paddingTop: 10, borderTopWidth: 2, borderTopColor: '#e5e7eb', gap: 8 },
  notesInput: { borderWidth: 2, borderColor: '#e5e7eb', borderRadius: 8, padding: 10, minHeight: 70, fontSize: 14, color: '#374151', textAlignVertical: 'top', backgroundColor: 'white' },
  notesInputDim: { opacity: 0.6 },
  noteCount: { fontSize: 11, color: '#9ca3af', textAlign: 'right' },

  // Histogram
  histWrap: { paddingTop: 10, borderTopWidth: 2, borderTopColor: '#e5e7eb', gap: 8 },
  histRow: { flexDirection: 'row', alignItems: 'flex-end', height: 140, backgroundColor: '#f9fafb', borderRadius: 8, padding: 8, gap: 4 },
  histCol: { flex: 1, alignItems: 'center', height: '100%' },
  histBarWrap: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  histVal: { fontSize: 8, fontWeight: '700', color: '#374151', marginBottom: 2 },
  histBar: { width: '80%', borderRadius: 3, minHeight: 4 },
  histLabel: { fontSize: 9, fontWeight: '600', color: '#6b7280', textAlign: 'center', marginTop: 4 },
  histLabelToday: { color: '#10b981', fontWeight: '700' },

  // Timeline
  noSessions: { textAlign: 'center', color: '#9ca3af', fontSize: 14 },
  sessionCard: { backgroundColor: 'white', borderRadius: 8, borderLeftWidth: 4, borderLeftColor: '#667eea', padding: 12, gap: 5 },
  sessionCardActive: { borderLeftColor: '#10b981', backgroundColor: '#f0fdf4' },
  sessionCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionNum: { fontSize: 13, fontWeight: '700', color: '#374151' },
  sessionDur: { fontSize: 14, fontWeight: '700', color: '#667eea' },
  sessionDurGreen: { color: '#10b981' },
  timeLabel: { fontSize: 12, color: '#6b7280' },
  startDot: { color: '#10b981', fontWeight: '700' },
  endDot: { color: '#ef4444', fontWeight: '700' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 },
  tag: { backgroundColor: '#ede9fe', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 2 },
  tagTxt: { fontSize: 11, fontWeight: '600', color: '#4f46e5' },

  // Lifetime
  lifetimeBox: { borderRadius: 12, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: '#667eea' },
  lifetimeStat: { alignItems: 'center' },
  lifetimeVal: { fontSize: 26, fontWeight: '700', color: 'white' },
  lifetimeLbl: { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5, marginTop: 4 },
  lifetimeDiv: { width: 1, height: 40, backgroundColor: 'rgba(255,255,255,0.3)' },

  // Version
  version: { fontSize: 11, color: '#c4b5fd', textAlign: 'center', marginTop: 4, marginBottom: 2 },
});
