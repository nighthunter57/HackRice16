import {writeUserData} from './user-storage';
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { demoPurchase } from "../../src/data/demo-profile";
import type { Purchase } from "../../src/types/finance";
import { historySchema, type HistoryEntry } from "./model";
import { analyze } from '../../src/lib/finance';
import type { DashboardData } from '../../src/types/api';
import { requestAnalysis, offlineDashboard, requestDemoExpense } from './api';
import { apiUrl } from './endpoint';
import { purchaseAnalysis } from '../../src/lib/finance/purchase-analysis';
import { financialSettingsListSchema, financialSettingsSchema, type FinancialSettings } from '../../src/types/financial-settings';
import { applyFinancialSettings, settingsFor } from '../../src/lib/finance/settings';
import { forecastChange } from '../../src/lib/finance/changes';
import { useAuth } from '../../src/lib/auth/auth-context';
import { balanceImpactExplanation } from '../../src/lib/balance-impact';


function useStoreValue() {
  const auth=useAuth();
  const userId=auth.user!.id;
  const storageKey=`canibuyit.mobile.history.v1:${userId}`;
  const settingsKey=`canibuyit.mobile.settings.v1:${userId}`;
  const [initialIdentity]=useState(()=>({userId,apiFetch:auth.apiFetch,storageKey,settingsKey}));
  const [current, setCurrent] = useState<DashboardData>(() =>
    offlineDashboard(demoPurchase, false,undefined,userId),
  );
  const [loading,setLoading]=useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(false);
  const [savedSourceKnown, setSavedSourceKnown] = useState(true);
  const [offlineDemo, setOfflineDemo] = useState(true);
  const [settingsList, setSettingsList] = useState<FinancialSettings[]>([]);
  const [settingsReady,setSettingsReady]=useState(false);
  const [refreshError, setRefreshError] = useState('');
  const requestVersion=useRef(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [ready, setReady] = useState(false);
  const storageUsable = useRef(true);
  const [storageError, setStorageError] = useState("");

  const [activeId, setActiveId] = useState<string | null>(null);
  const [repair, setRepair] = useState(false);
  // Refresh the home snapshot without creating a purchase-history entry.
  useEffect(() => {
    let mounted = true;
    const version = ++requestVersion.current;
    AsyncStorage.getItem(initialIdentity.settingsKey).then(raw=>raw ? financialSettingsListSchema.parse(JSON.parse(raw)).filter(s=>s.userId===initialIdentity.userId) : [])
      .then(async entries=>{
        if (!mounted) return;
        setSettingsList(entries);
        if(version===requestVersion.current) setCurrent(offlineDashboard(demoPurchase,false,entries.find(s=>s.dataSource==='demo'),initialIdentity.userId));
        setSettingsReady(true);
        const result = await requestAnalysis(demoPurchase,false,apiUrl,'',undefined,initialIdentity.apiFetch,undefined,entries);
        const settings = entries.find(s=>s.userId===result.profile.userId && s.dataSource===result.dataSource);
        const profile = applyFinancialSettings(result.profile,result.dataSource,settings);
        const analysis = analyze(profile,result.purchase);
        if(mounted && version===requestVersion.current) {setCurrent({...result,profile,analysis,...purchaseAnalysis(result.dataSource,analysis),explanation:balanceImpactExplanation(analysis.today.balanceImpact)});setOfflineDemo(false);}
      })
      .catch(()=>{if(mounted) {setSettingsReady(true);if(version===requestVersion.current) setRefreshError('Couldn’t refresh your accounts. Showing sample finances.');}});
    return ()=>{mounted=false;};
  }, [initialIdentity]);
  useEffect(() => {
    let mounted = true;
    AsyncStorage.getItem(initialIdentity.storageKey)
      .then((raw) => {
        if (!mounted) return;
        if (raw) setHistory(historySchema.parse(JSON.parse(raw)).filter(entry=>entry.profile?.userId===initialIdentity.userId));
      })
      .catch(() => {
        storageUsable.current = false;
        if (mounted)
          setStorageError(
            "Saved history could not be loaded. New checks are available for this session.",
          );
      })
      .finally(() => {
        if (mounted) setReady(true);
      });
    return () => {
      mounted = false;
    };
  }, [initialIdentity]);
  useEffect(() => {
    if (!ready || !storageUsable.current) return;
    void writeUserData(storageKey, JSON.stringify(history))
      .catch(() =>
        setStorageError(
          "History could not be saved on this device. Your current result is still available.",
        ),
      );
  }, [history, ready,storageKey]);
  async function check(
    purchase: Purchase,
    withRepair = repair,
    decision: HistoryEntry["decision"] = "Checked",
    useDemo = false,
  ) {
    const version=++requestVersion.current;
    setLoading(true);
    let next:DashboardData;
    try {
      const settings = settingsList.find(s=>s.userId===current.profile.userId && s.dataSource===current.dataSource);
      const demoSettings = settingsList.find(s=>s.dataSource==='demo');
      next = useDemo ? offlineDashboard(purchase,withRepair,demoSettings,userId) : await requestAnalysis(purchase,withRepair,apiUrl,'',current.snapshotId,auth.apiFetch,settings,settingsList);
    } catch {
      throw new Error('We couldn’t update your finances. Try again or use sample finances.');
    } finally {
      if(version===requestVersion.current) setLoading(false);
    }
    if(version!==requestVersion.current) throw new Error('Your selection changed. Please check this purchase again.');
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setCurrent(next);
    setRefreshError('');
    setOfflineDemo(useDemo);
    setSavedSnapshot(false);
    setSavedSourceKnown(true);
    setRepair(withRepair);
    setActiveId(id);
    setHistory((items) =>
      [
        {
          id,
          purchase,
          checkedAt: new Date().toISOString(),
          repair: withRepair,
          profile: next.profile,
          dataSource: next.dataSource,
          decision,
        },
        ...items,
      ].slice(0, 50),
    );
  }
  function open(entry: HistoryEntry) {
    requestVersion.current++;
    setLoading(false);
    const saved=offlineDashboard(entry.purchase,entry.repair,undefined,userId);
    saved.dataSource=entry.dataSource ?? 'demo';
    saved.services=[];
    if(entry.profile) {saved.profile=entry.profile;saved.planningProfile=entry.profile;saved.accountChoices=entry.profile.accounts;saved.analysis=analyze(entry.profile,entry.purchase);}
    Object.assign(saved,purchaseAnalysis(saved.dataSource,saved.analysis));
    saved.explanation='Saved result. Check again for an updated forecast.';
    setCurrent(saved);
    setOfflineDemo(saved.dataSource === 'demo');
    setSavedSnapshot(true);
    setSavedSourceKnown(entry.dataSource !== undefined);
    setRepair(entry.repair);
    setActiveId(entry.id);
  }
  async function refresh() {
    const version = ++requestVersion.current;
    setLoading(true);
    setRefreshError('');
    try {
      const settings = settingsList.find(s=>s.userId===current.profile.userId && s.dataSource===current.dataSource);
      const next = await requestAnalysis(current.purchase,false,apiUrl,'',current.snapshotId,auth.apiFetch,settings,settingsList);
      if (version !== requestVersion.current) return;
      setCurrent({...next,change:next.change??forecastChange(current.profile,next.profile,current.purchase)});
      setOfflineDemo(false);setSavedSnapshot(false);setSavedSourceKnown(true);setRepair(false);setActiveId(null);
    } catch {
      if (version===requestVersion.current) setRefreshError('Couldn’t refresh. Your last result is still available.');
    } finally {if(version===requestVersion.current) setLoading(false);}
  }
  async function saveSettings(input:FinancialSettings) {
    const parsed=financialSettingsSchema.safeParse(input);
    if(!parsed.success) throw new Error('Choose at least one spending account and check the amounts, dates, and goal settings.');
    const settings = parsed.data;
    if (settings.userId!==current.profile.userId || settings.dataSource!==current.dataSource) throw new Error('The financial profile changed. Reopen Financial setup.');
    const profile = applyFinancialSettings(current.planningProfile??{...current.profile,accounts:current.accountChoices??current.profile.accounts},current.dataSource,settings);
    const analysis = analyze(profile,current.purchase);
    const list = [...settingsList.filter(s=>s.userId!==settings.userId || s.dataSource!==settings.dataSource),settings];
    const version=++requestVersion.current;
    setLoading(true);
    try {
      await writeUserData(settingsKey,JSON.stringify(list));
      setSettingsList(list);
      if(version!==requestVersion.current) throw new Error('Setup was saved. Reopen the selected result to use it.');
      setCurrent({...current,profile,analysis,...purchaseAnalysis(current.dataSource,analysis),snapshotId:undefined,
        explanation:balanceImpactExplanation(analysis.today.balanceImpact),
        change:forecastChange(current.profile,profile,current.purchase)});
      setActiveId(null);setSavedSnapshot(false);
    } finally {if(version===requestVersion.current) setLoading(false);}
  }
  async function simulateNessieExpense() {
    const version=++requestVersion.current;
    setLoading(true);
    try {
      const settings=settingsList.find(s=>s.userId===current.profile.userId && s.dataSource===current.dataSource)??settingsFor(current.profile,current.dataSource);
      const receipt=await requestDemoExpense(current,apiUrl,'',settings,auth.apiFetch);
      if(version!==requestVersion.current) return 'Expense requested. Refresh the selected result to see the latest data.';
      if(receipt.dashboard) {
        const next=receipt.dashboard;
        setCurrent({...next,change:next.change??forecastChange(current.profile,next.profile,current.purchase)});
        setOfflineDemo(false);setSavedSnapshot(false);setActiveId(null);setRefreshError('');
      }
      const status=receipt.status==='pending'?'Expense scheduled.':'Expense recorded.';
      return `${status} ${receipt.dashboard?'Your forecast is updated.':'Refresh your finances to update the forecast.'}`;
    } finally {if(version===requestVersion.current) setLoading(false);}
  }
  function decide(decision: HistoryEntry["decision"]) {
    if (activeId === null) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setActiveId(id);
      setHistory(items => [{id, purchase: current.purchase, profile: current.profile, dataSource: current.dataSource,
        repair, decision, checkedAt: new Date().toISOString()}, ...items].slice(0, 50));
      return;
    }
    setHistory((items) =>
      items.map((item) =>
        item.id === activeId ? { ...item, decision } : item,
      ),
    );
  }
  return {
    current,
    refresh,refreshError,saveSettings,simulateNessieExpense,
    settings:settingsList.find(s=>s.userId===current.profile.userId && s.dataSource===current.dataSource)??settingsFor(current.profile,current.dataSource),
    loading,
    savedSnapshot,
    savedSourceKnown,
    offlineDemo,
    history,
    ready:ready && settingsReady,
    storageError,
    check,
    checkDemo: (purchase: Purchase, withRepair = repair) => check(purchase, withRepair, 'Checked', true),
    open,
    decide,
    repair,
  };
}
const Store = createContext<ReturnType<typeof useStoreValue> | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const value = useStoreValue();
  return <Store.Provider value={value}>{children}</Store.Provider>;
}
export function useApp() {
  const value = useContext(Store);
  if (!value) throw new Error("AppProvider is required");
  return value;
}
