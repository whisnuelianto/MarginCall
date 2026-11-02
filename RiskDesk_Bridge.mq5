//+------------------------------------------------------------------+
//|                                            RiskDesk_Bridge.mq5   |
//|  Mengirim info akun, posisi terbuka & pending order ke RiskDesk. |
//|  EA ini TIDAK membuka, mengubah, atau menutup posisi apa pun.    |
//+------------------------------------------------------------------+
#property copyright   "RiskDesk"
#property version     "2.20"
#property description "Kirim posisi terbuka dan pending order MT5 ke RiskDesk secara berkala (hanya membaca, tidak trading)."

input string SupabaseUrl     = "https://xxxx.supabase.co"; // Project URL Supabase
input string AnonKey         = "";                         // Anon / publishable key
input string SyncToken       = "";                         // SyncToken dari RiskDesk → Pengaturan → Cloud & MT5
input int    IntervalSeconds = 10;                         // Jeda pengiriman (detik, minimal 5)
input int    HistoryDays     = 30;                         // Trade tertutup N hari terakhir untuk jurnal otomatis (0 = mati)
input bool   SendQuotes      = true;                       // Kirim harga bid/ask Market Watch untuk kalkulator
input group  "Notifikasi 24 jam ke HP"
input bool   PushNotif       = true;                       // Push MT5 (isi MetaQuotes ID: Tools > Options > Notifications)
input string TelegramToken   = "";                         // Opsional: token bot Telegram dari @BotFather
input string TelegramChatId  = "";                         // Opsional: chat id Telegram tujuan
input double WarnRiskPct     = 20;                         // Peringatan dini total risiko SL (% balance)
input double MaxRiskPct      = 25;                         // Batas total risiko SL (% balance)
input double DailyLossPct    = 5;                          // Batas rugi harian (% balance awal hari)

uint   g_lastPush = 0;
string g_status   = "";
int    g_closedSent = 0;
int    g_riskLevel = 0;        // 0 aman, 1 peringatan, 2 batas
int    g_dailyDay  = -1;       // hari terakhir peringatan rugi harian dikirim
ulong  g_noSlSent[];           // tiket yang sudah diberi peringatan tanpa SL
ulong  g_pendPrev[];           // tiket pending pada siklus sebelumnya
bool   g_alertInit = false;

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(SupabaseUrl) < 12 || StringFind(SupabaseUrl, "xxxx") >= 0 || StringLen(AnonKey) < 20 || StringLen(SyncToken) < 16)
     {
      Alert("RiskDesk Bridge: isi SupabaseUrl, AnonKey, dan SyncToken di tab Inputs.");
      return(INIT_PARAMETERS_INCORRECT);
     }
   EventSetTimer(MathMax(5, IntervalSeconds));
   Push();
   return(INIT_SUCCEEDED);
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

void OnTimer() { Push(); }

// Kirim segera saat ada perubahan posisi (dibatasi maksimal 1x per 2 detik)
void OnTrade()
  {
   if(GetTickCount() - g_lastPush > 2000)
      Push();
  }

//+------------------------------------------------------------------+
string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   return(s);
  }

string Num(double v, int digits = 8)
  {
   if(!MathIsValidNumber(v)) return("null");
   return(DoubleToString(v, digits));
  }

string BaseUrl()
  {
   string u = SupabaseUrl;
   StringTrimRight(u);
   StringTrimLeft(u);
   while(StringLen(u) > 0 && StringSubstr(u, StringLen(u) - 1, 1) == "/")
      u = StringSubstr(u, 0, StringLen(u) - 1);
   return(u);
  }

//+------------------------------------------------------------------+
string PendingName(long t)
  {
   switch((int)t)
     {
      case ORDER_TYPE_BUY_LIMIT:       return("buy_limit");
      case ORDER_TYPE_SELL_LIMIT:      return("sell_limit");
      case ORDER_TYPE_BUY_STOP:        return("buy_stop");
      case ORDER_TYPE_SELL_STOP:       return("sell_stop");
      case ORDER_TYPE_BUY_STOP_LIMIT:  return("buy_stop_limit");
      case ORDER_TYPE_SELL_STOP_LIMIT: return("sell_stop_limit");
     }
   return("");
  }

bool IsBuyType(long t)
  {
   return(t == ORDER_TYPE_BUY_LIMIT || t == ORDER_TYPE_BUY_STOP || t == ORDER_TYPE_BUY_STOP_LIMIT);
  }

// Pending order (limit / stop) ditambahkan ke array yang sama dengan "kind":"pending"
void AppendPending(string &out, int &count, int &pend)
  {
   int total = OrdersTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      long   otype = OrderGetInteger(ORDER_TYPE);
      string name  = PendingName(otype);
      if(name == "") continue; // abaikan order market yang sedang diproses

      string sym   = OrderGetString(ORDER_SYMBOL);
      double vol   = OrderGetDouble(ORDER_VOLUME_CURRENT);
      double price = OrderGetDouble(ORDER_PRICE_OPEN);
      double slim  = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
      double sl    = OrderGetDouble(ORDER_SL);
      double tp    = OrderGetDouble(ORDER_TP);
      double cur   = OrderGetDouble(ORDER_PRICE_CURRENT);
      long   setup = OrderGetInteger(ORDER_TIME_SETUP);
      long   expir = OrderGetInteger(ORDER_TIME_EXPIRATION);
      int    dg    = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      bool   buy   = IsBuyType(otype);
      // Untuk Stop Limit, harga eksekusi adalah harga limit-nya
      double fill  = (slim > 0 && (otype == ORDER_TYPE_BUY_STOP_LIMIT || otype == ORDER_TYPE_SELL_STOP_LIMIT)) ? slim : price;

      ENUM_ORDER_TYPE ot = buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      string lossAtSl = "null", profitAtTp = "null";
      double val = 0;
      if(sl > 0 && OrderCalcProfit(ot, sym, vol, fill, sl, val)) lossAtSl = Num(val, 2);
      if(tp > 0 && OrderCalcProfit(ot, sym, vol, fill, tp, val)) profitAtTp = Num(val, 2);

      if(count > 0) out += ",";
      out += "{";
      out += "\"kind\":\"pending\",";
      out += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      out += "\"symbol\":\"" + Esc(sym) + "\",";
      out += "\"type\":\"" + (buy ? "buy" : "sell") + "\",";
      out += "\"order_type\":\"" + name + "\",";
      out += "\"volume\":" + Num(vol, 2) + ",";
      out += "\"price_open\":" + Num(fill, dg) + ",";
      out += "\"price_trigger\":" + Num(price, dg) + ",";
      out += "\"sl\":" + Num(sl, dg) + ",";
      out += "\"tp\":" + Num(tp, dg) + ",";
      out += "\"price_current\":" + Num(cur, dg) + ",";
      out += "\"profit\":0,\"swap\":0,";
      out += "\"loss_at_sl\":" + lossAtSl + ",";
      out += "\"profit_at_tp\":" + profitAtTp + ",";
      out += "\"time\":" + IntegerToString(setup) + ",";
      out += "\"expiration\":" + IntegerToString(expir);
      out += "}";
      count++;
      pend++;
     }
  }

//+------------------------------------------------------------------+
int FindIdx(ulong &arr[], ulong v) { for(int i = 0; i < ArraySize(arr); i++) if(arr[i] == v) return(i); return(-1); }

// Trade tertutup N hari terakhir ("kind":"closed") untuk jurnal otomatis
void AppendClosed(string &out, int &count)
  {
   if(HistoryDays <= 0) return;
   datetime now = TimeCurrent(), since = now - (datetime)HistoryDays * 86400, from = since - (datetime)60 * 86400;
   if(!HistorySelect(from, now)) return;
   ulong  pid[]; long ptype[]; double pvol[], popen[], pclose[], pcvol[], pprofit[], psl[], ptp[]; long tin[], tout[]; string psym[];
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong d = HistoryDealGetTicket(i); if(d == 0) continue;
      long entry = HistoryDealGetInteger(d, DEAL_ENTRY), dtype = HistoryDealGetInteger(d, DEAL_TYPE);
      if(dtype != DEAL_TYPE_BUY && dtype != DEAL_TYPE_SELL) continue;
      ulong pos = (ulong)HistoryDealGetInteger(d, DEAL_POSITION_ID);
      int k = FindIdx(pid, pos);
      if(k < 0)
        {
         k = ArraySize(pid);
         ArrayResize(pid, k + 1); ArrayResize(ptype, k + 1); ArrayResize(pvol, k + 1); ArrayResize(popen, k + 1); ArrayResize(pclose, k + 1);
         ArrayResize(pcvol, k + 1); ArrayResize(pprofit, k + 1); ArrayResize(psl, k + 1); ArrayResize(ptp, k + 1); ArrayResize(tin, k + 1); ArrayResize(tout, k + 1); ArrayResize(psym, k + 1);
         pid[k] = pos; ptype[k] = -1; pvol[k] = 0; popen[k] = 0; pclose[k] = 0; pcvol[k] = 0; pprofit[k] = 0; psl[k] = 0; ptp[k] = 0; tin[k] = 0; tout[k] = 0;
         psym[k] = HistoryDealGetString(d, DEAL_SYMBOL);
        }
      double vol = HistoryDealGetDouble(d, DEAL_VOLUME), price = HistoryDealGetDouble(d, DEAL_PRICE);
      pprofit[k] += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_FEE);
      if(entry == DEAL_ENTRY_IN)
        { ptype[k] = dtype; popen[k] = (popen[k] * pvol[k] + price * vol) / MathMax(pvol[k] + vol, 1e-9); pvol[k] += vol; tin[k] = (long)HistoryDealGetInteger(d, DEAL_TIME); }
      else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
        { pclose[k] = (pclose[k] * pcvol[k] + price * vol) / MathMax(pcvol[k] + vol, 1e-9); pcvol[k] += vol; tout[k] = (long)HistoryDealGetInteger(d, DEAL_TIME);
          psl[k] = HistoryDealGetDouble(d, DEAL_SL); ptp[k] = HistoryDealGetDouble(d, DEAL_TP); }
     }
   int sent = 0;
   for(int k = 0; k < ArraySize(pid) && sent < 300; k++)
     {
      if(ptype[k] < 0 || tout[k] < (long)since || pcvol[k] + 1e-9 < pvol[k]) continue; // belum tertutup penuh
      if(PositionSelectByTicket(pid[k])) continue;
      bool buy = (ptype[k] == DEAL_TYPE_BUY);
      int dg = (int)SymbolInfoInteger(psym[k], SYMBOL_DIGITS);
      string lossAtSl = "null"; double val = 0;
      if(psl[k] > 0 && OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, psym[k], pvol[k], popen[k], psl[k], val)) lossAtSl = Num(val, 2);
      if(count > 0) out += ",";
      out += "{\"kind\":\"closed\",\"ticket\":" + IntegerToString((long)pid[k]) + ",\"symbol\":\"" + Esc(psym[k]) + "\",\"type\":\"" + (buy ? "buy" : "sell") + "\",";
      out += "\"volume\":" + Num(pvol[k], 2) + ",\"price_open\":" + Num(popen[k], dg) + ",\"price_close\":" + Num(pclose[k], dg) + ",";
      out += "\"sl\":" + Num(psl[k], dg) + ",\"tp\":" + Num(ptp[k], dg) + ",\"profit\":" + Num(pprofit[k], 2) + ",\"loss_at_sl\":" + lossAtSl + ",";
      out += "\"time_open\":" + IntegerToString(tin[k]) + ",\"time_close\":" + IntegerToString(tout[k]) + "}";
      count++; sent++;
     }
  }

string BuildQuotes()
  {
   if(!SendQuotes) return("[]");
   string q = "["; int n = 0, total = MathMin(SymbolsTotal(true), 80);
   for(int i = 0; i < total; i++)
     {
      string s = SymbolName(i, true); double b = SymbolInfoDouble(s, SYMBOL_BID), a = SymbolInfoDouble(s, SYMBOL_ASK);
      if(b <= 0 || a <= 0) continue;
      int dg = (int)SymbolInfoInteger(s, SYMBOL_DIGITS);
      if(n > 0) q += ",";
      q += "{\"s\":\"" + Esc(s) + "\",\"b\":" + Num(b, dg) + ",\"a\":" + Num(a, dg) + ",\"d\":" + IntegerToString(dg) + "}"; n++;
     }
   return(q + "]");
  }

//+------------------------------------------------------------------+
string BuildPositions(int &count, int &pend)
  {
   string out = "[";
   count = 0;
   pend = 0;
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;

      string sym    = PositionGetString(POSITION_SYMBOL);
      long   type   = PositionGetInteger(POSITION_TYPE);
      double vol    = PositionGetDouble(POSITION_VOLUME);
      double open   = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      double cur    = PositionGetDouble(POSITION_PRICE_CURRENT);
      double profit = PositionGetDouble(POSITION_PROFIT);
      double swap   = PositionGetDouble(POSITION_SWAP);
      long   opened = PositionGetInteger(POSITION_TIME);
      int    dg     = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);

      ENUM_ORDER_TYPE ot = (type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;

      // Hitung rugi/untung di SL/TP langsung oleh MT5 (akurat sesuai spesifikasi broker)
      string lossAtSl = "null", profitAtTp = "null";
      double val = 0;
      if(sl > 0 && OrderCalcProfit(ot, sym, vol, open, sl, val)) lossAtSl = Num(val, 2);
      if(tp > 0 && OrderCalcProfit(ot, sym, vol, open, tp, val)) profitAtTp = Num(val, 2);

      if(count > 0) out += ",";
      out += "{";
      out += "\"kind\":\"open\",";
      out += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      out += "\"symbol\":\"" + Esc(sym) + "\",";
      out += "\"type\":\"" + (type == POSITION_TYPE_BUY ? "buy" : "sell") + "\",";
      out += "\"volume\":" + Num(vol, 2) + ",";
      out += "\"price_open\":" + Num(open, dg) + ",";
      out += "\"sl\":" + Num(sl, dg) + ",";
      out += "\"tp\":" + Num(tp, dg) + ",";
      out += "\"price_current\":" + Num(cur, dg) + ",";
      out += "\"profit\":" + Num(profit, 2) + ",";
      out += "\"swap\":" + Num(swap, 2) + ",";
      out += "\"loss_at_sl\":" + lossAtSl + ",";
      out += "\"profit_at_tp\":" + profitAtTp + ",";
      out += "\"time\":" + IntegerToString(opened);
      out += "}";
      count++;
     }
   AppendPending(out, count, pend);
   int before = count; AppendClosed(out, count); g_closedSent = count - before;
   out += "]";
   return(out);
  }

string BuildAccount()
  {
   string a = "{";
   a += "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   a += "\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",";
   a += "\"currency\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY)) + "\",";
   a += "\"leverage\":" + IntegerToString(AccountInfoInteger(ACCOUNT_LEVERAGE)) + ",";
   a += "\"balance\":" + Num(AccountInfoDouble(ACCOUNT_BALANCE), 2) + ",";
   a += "\"equity\":" + Num(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",";
   a += "\"margin\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN), 2) + ",";
   a += "\"margin_free\":" + Num(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2) + ",";
   a += "\"quotes\":" + BuildQuotes();
   a += "}";
   return(a);
  }

//+------------------------------------------------------------------+
string UrlEnc(string s)
  {
   uchar c[]; StringToCharArray(s, c, 0, WHOLE_ARRAY, CP_UTF8); string o = "";
   for(int i = 0; i < ArraySize(c) - 1; i++)
     {
      uchar x = c[i];
      if((x >= 'a' && x <= 'z') || (x >= 'A' && x <= 'Z') || (x >= '0' && x <= '9') || x == '-' || x == '_' || x == '.') o += CharToString(x);
      else o += StringFormat("%%%02X", x);
     }
   return(o);
  }

void Notify(string msg)
  {
   string text = "RiskDesk: " + msg;
   if(PushNotif && TerminalInfoInteger(TERMINAL_NOTIFICATIONS_ENABLED)) SendNotification(text);
   if(StringLen(TelegramToken) > 10 && StringLen(TelegramChatId) > 0)
     {
      char data[], res[]; string rh;
      string url = "https://api.telegram.org/bot" + TelegramToken + "/sendMessage?chat_id=" + UrlEnc(TelegramChatId) + "&text=" + UrlEnc(text);
      if(WebRequest("GET", url, "", 5000, data, res, rh) == -1) Print("RiskDesk Telegram: izinkan https://api.telegram.org di Allow WebRequest");
     }
   Print(text);
  }

// Peringatan 24 jam: total risiko SL, posisi tanpa SL, pending terisi, rugi harian
void CheckAlerts()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE); if(bal <= 0) return;
   string cur = AccountInfoString(ACCOUNT_CURRENCY);
   double risk = 0, val = 0; int noSl = 0;
   for(int i = 0; i < PositionsTotal(); i++)
     {
      ulong t = PositionGetTicket(i); if(t == 0) continue;
      string sym = PositionGetString(POSITION_SYMBOL); double sl = PositionGetDouble(POSITION_SL), vol = PositionGetDouble(POSITION_VOLUME), op = PositionGetDouble(POSITION_PRICE_OPEN);
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      if(sl <= 0)
        {
         noSl++;
         if(g_alertInit && FindIdx(g_noSlSent, t) < 0) { Notify("Posisi " + sym + " " + (buy ? "BUY " : "SELL ") + DoubleToString(vol, 2) + " lot TANPA stop loss."); }
         if(FindIdx(g_noSlSent, t) < 0) { int n = ArraySize(g_noSlSent); ArrayResize(g_noSlSent, n + 1); g_noSlSent[n] = t; }
         continue;
        }
      if(OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, sym, vol, op, sl, val) && val < 0) risk += -val;
     }
   ulong pendNow[];
   for(int i = 0; i < OrdersTotal(); i++)
     {
      ulong t = OrderGetTicket(i); if(t == 0 || PendingName(OrderGetInteger(ORDER_TYPE)) == "") continue;
      int n = ArraySize(pendNow); ArrayResize(pendNow, n + 1); pendNow[n] = t;
      double sl = OrderGetDouble(ORDER_SL); if(sl <= 0) continue;
      bool buy = IsBuyType(OrderGetInteger(ORDER_TYPE));
      if(OrderCalcProfit(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, OrderGetString(ORDER_SYMBOL), OrderGetDouble(ORDER_VOLUME_CURRENT), OrderGetDouble(ORDER_PRICE_OPEN), sl, val) && val < 0) risk += -val;
     }
   // Pending yang hilang dan kini menjadi posisi = terisi
   if(g_alertInit)
      for(int i = 0; i < ArraySize(g_pendPrev); i++)
         if(FindIdx(pendNow, g_pendPrev[i]) < 0 && PositionSelectByTicket(g_pendPrev[i]))
            Notify("Pending order " + PositionGetString(POSITION_SYMBOL) + " " + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + " lot TERISI menjadi posisi.");
   ArrayResize(g_pendPrev, ArraySize(pendNow)); for(int i = 0; i < ArraySize(pendNow); i++) g_pendPrev[i] = pendNow[i];
   // Total risiko
   double pct = risk / bal * 100.0;
   int lvl = pct >= MaxRiskPct ? 2 : (pct >= WarnRiskPct ? 1 : 0);
   if(g_alertInit && lvl > g_riskLevel)
      Notify((lvl == 2 ? "BATAS risiko tersentuh: " : "Mendekati batas risiko: ") + "total SL " + DoubleToString(pct, 1) + "% dari balance (" + DoubleToString(risk, 2) + " " + cur + ").");
   g_riskLevel = lvl;
   // Rugi harian (terealisasi hari ini)
   MqlDateTime dt; TimeToStruct(TimeCurrent(), dt); dt.hour = 0; dt.min = 0; dt.sec = 0; datetime dayStart = StructToTime(dt);
   if(DailyLossPct > 0 && HistorySelect(dayStart, TimeCurrent()))
     {
      double pl = 0;
      for(int i = 0; i < HistoryDealsTotal(); i++) { ulong d = HistoryDealGetTicket(i); long tp = HistoryDealGetInteger(d, DEAL_TYPE); if(tp != DEAL_TYPE_BUY && tp != DEAL_TYPE_SELL) continue;
        pl += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_FEE); }
      double startBal = bal - pl;
      if(pl < 0 && startBal > 0 && -pl / startBal * 100.0 >= DailyLossPct && g_dailyDay != dt.day_of_year)
        { if(g_alertInit) Notify("Batas rugi harian tercapai: " + DoubleToString(-pl, 2) + " " + cur + " (" + DoubleToString(-pl / startBal * 100.0, 1) + "%). Sebaiknya berhenti trading hari ini."); g_dailyDay = dt.day_of_year; }
     }
   g_alertInit = true;
  }

//+------------------------------------------------------------------+
void Push()
  {
   g_lastPush = GetTickCount();
   int n = 0, pend = 0;
   string body = "{\"p_token\":\"" + Esc(SyncToken) + "\",\"p_account\":" + BuildAccount() + ",\"p_positions\":" + BuildPositions(n, pend) + "}";

   char data[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(len > 0) ArrayResize(data, len - 1); // buang karakter null di akhir

   string headers = "Content-Type: application/json\r\napikey: " + AnonKey + "\r\n";
   char   result[];
   string resultHeaders;

   ResetLastError();
   int code = WebRequest("POST", BaseUrl() + "/rest/v1/rpc/riskdesk_push", headers, 8000, data, result, resultHeaders);

   if(code == -1)
     {
      int err = GetLastError();
      if(err == 4014)
         g_status = "Izinkan URL di Tools > Options > Expert Advisors > Allow WebRequest: " + BaseUrl();
      else
         g_status = "Gagal terhubung (error " + IntegerToString(err) + ")";
      Print("RiskDesk Bridge: ", g_status);
     }
   else
     {
      string resp = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      if(code != 200)
        {
         g_status = "HTTP " + IntegerToString(code) + ". Cek AnonKey dan supabase-setup.sql.";
         Print("RiskDesk Bridge: HTTP ", code, " ", resp);
        }
      else if(StringFind(resp, "false") >= 0)
         g_status = "SyncToken tidak dikenali. Salin ulang dari RiskDesk.";
      else
         g_status = "Tersinkron " + TimeToString(TimeLocal(), TIME_MINUTES | TIME_SECONDS) + " | " + IntegerToString(n - pend - g_closedSent) + " posisi, " + IntegerToString(pend) + " pending";
     }
   CheckAlerts();
   Comment("RiskDesk Bridge\n", g_status, "\nRisiko SL: level ", g_riskLevel == 2 ? "BATAS" : (g_riskLevel == 1 ? "peringatan" : "aman"), " | ", g_closedSent, " trade tertutup terkirim");
  }
//+------------------------------------------------------------------+
