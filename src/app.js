const CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  currency: "PKR"
};

const categories = [
  ["dining", "Dining", ["kfc", "food", "restaurant", "burger", "pizza", "chai", "coffee"]],
  ["groceries", "Groceries", ["grocery", "groceries", "mart", "amazon fresh", "milk", "fruit"]],
  ["transport", "Transport", ["fuel", "uber", "careem", "petrol", "bus", "taxi"]],
  ["utilities", "Utilities", ["bill", "electric", "gas", "internet", "water"]],
  ["health", "Health", ["doctor", "medicine", "pharmacy", "hospital"]],
  ["personal", "Personal Care", ["haircut", "salon", "shave"]],
  ["family", "Family", ["ammi", "abba", "mama", "papa", "brother", "sister", "wife"]],
  ["shopping", "Shopping", ["clothes", "shoes", "daraz", "amazon"]],
  ["received", "Received", ["received", "recieved", "got", "income", "salary"]],
  ["other", "Other", []]
];

const state = {
  session: null,
  user: null,
  months: [],
  activeMonthId: null,
  transactions: [],
  view: "input",
  lastResult: null,
  pendingClarification: null,
  pendingMonth: null,
  busy: false,
  authMode: "signin",
  authError: "",
  authNotice: "",
  parseStatus: "",
  listening: false,
  exportPickerMonthId: null
};

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("en-PK", { maximumFractionDigits: 0 });
const todayISO = () => new Date().toISOString();
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fmt = (value) => `Rs. ${money.format(Math.round(Number(value) || 0))}`;
const monthName = () => new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date());

const store = {
  read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

const db = {
  get configured() {
    return Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
  },
  headers(token = state.session?.access_token) {
    return {
      apikey: CONFIG.supabaseAnonKey,
      Authorization: `Bearer ${token || CONFIG.supabaseAnonKey}`,
      "Content-Type": "application/json"
    };
  },
  async signIn(email, password) {
    if (!this.configured) {
      const session = { access_token: "local-dev", user: { id: email, email } };
      store.write("expense_ai_session", session);
      return session;
    }
    const url = `${CONFIG.supabaseUrl}/auth/v1/token?grant_type=password`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(null),
      body: JSON.stringify({ email, password })
    });
    return check(response);
  },
  async signUp(email, password) {
    if (!this.configured) return this.signIn(email, password);
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/signup`, {
      method: "POST",
      headers: this.headers(null),
      body: JSON.stringify({ email, password })
    });
    return check(response);
  },
  async refreshSession() {
    if (!this.configured || !state.session?.refresh_token) return state.session;
    const response = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: this.headers(null),
      body: JSON.stringify({ refresh_token: state.session.refresh_token })
    });
    const session = await check(response);
    store.write("expense_ai_session", session);
    return session;
  },
  async load() {
    const local = store.read("expense_ai_data", null);
    if (!this.configured || state.session?.access_token === "local-dev") {
      return local || seedData();
    }
    const monthsRes = await fetch(`${CONFIG.supabaseUrl}/rest/v1/months?select=*&order=created_at.desc`, {
      headers: this.headers()
    });
    const txRes = await fetch(`${CONFIG.supabaseUrl}/rest/v1/transactions?select=*&order=created_at.desc`, {
      headers: this.headers()
    });
    return { months: await check(monthsRes), transactions: await check(txRes) };
  },
  async saveMonth(month) {
    upsertLocalMonth(month);
    if (!this.configured || state.session?.access_token === "local-dev") return;
    await check(await fetch(`${CONFIG.supabaseUrl}/rest/v1/months?on_conflict=id`, {
      method: "POST",
      headers: { ...this.headers(), Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(month)
    }));
  },
  async saveTransactions(items) {
    items.forEach(upsertLocalTransaction);
    if (!this.configured || state.session?.access_token === "local-dev") return;
    await check(await fetch(`${CONFIG.supabaseUrl}/rest/v1/transactions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(items)
    }));
  }
};

async function check(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.msg || data?.message || data?.error || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

// True only when the server explicitly rejects the credentials/token.
// Network failures (offline, DNS, timeouts) throw TypeErrors with no
// status, and those must NOT trigger a logout.
function isAuthError(error) {
  return error && (error.status === 400 || error.status === 401 || error.status === 403);
}

function seedData() {
  return {
    months: [],
    transactions: []
  };
}

function saveLocal() {
  store.write("expense_ai_data", { months: state.months, transactions: state.transactions });
}

function upsertLocalMonth(month) {
  state.months = [month, ...state.months.filter((item) => item.id !== month.id)];
  saveLocal();
}

function upsertLocalTransaction(tx) {
  state.transactions = [tx, ...state.transactions.filter((item) => item.id !== tx.id)];
  saveLocal();
}

async function boot() {
  await loadConfig();
  state.session = store.read("expense_ai_session", null);
  state.user = state.session?.user || null;
  if (state.session) {
    try {
      state.session = await db.refreshSession();
      state.user = state.session?.user || state.user;
      await loadData();
    } catch (error) {
      // Only force a logout if the credentials themselves are bad
      // (expired/revoked refresh token). A network hiccup must NOT log
      // the user out — they asked to stay signed in until they choose
      // to sign out, so we keep the saved session and retry next launch.
      if (isAuthError(error)) {
        localStorage.removeItem("expense_ai_session");
        state.session = null;
        state.user = null;
      } else {
        try {
          await loadData();
        } catch {}
      }
    }
  }
  render();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) return;
    const config = await response.json();
    CONFIG.supabaseUrl = config.supabaseUrl || "";
    CONFIG.supabaseAnonKey = config.supabaseAnonKey || "";
    CONFIG.currency = config.currency || "PKR";
  } catch {}
}

async function loadData() {
  const data = await db.load();
  state.months = data.months || [];
  state.transactions = data.transactions || [];
  state.activeMonthId = state.months[0]?.id || null;
}

function activeMonth() {
  return state.months.find((month) => month.id === state.activeMonthId) || state.months[0];
}

function monthTransactions() {
  const month = activeMonth();
  return state.transactions.filter((tx) => tx.month_id === month?.id);
}

function totals() {
  const month = activeMonth();
  const txs = monthTransactions();
  const spent = txs.filter((tx) => ["expense", "loan_sent"].includes(tx.kind)).reduce((sum, tx) => sum + tx.amount, 0);
  const received = txs.filter((tx) => ["income", "loan_received"].includes(tx.kind)).reduce((sum, tx) => sum + tx.amount, 0);
  const salary = Number(month?.salary || 0);
  return { salary, spent, received, remaining: salary + received - spent };
}

function render() {
  if (!state.session) return renderAuth();
  if (!state.months.length || needsSalarySetup()) return renderFirstMonth();
  if (state.pendingMonth) return renderMissingMonth();
  if (state.pendingClarification) return renderClarification();
  if (state.exportPickerMonthId !== null) return renderExportPicker();
  if (state.view === "history") return renderHistory();
  if (state.view === "success") return renderSuccess();
  renderInput();
}

function needsSalarySetup() {
  return state.months.length === 1 && Number(state.months[0].salary || 0) === 0 && state.transactions.length === 0;
}

function renderFirstMonth() {
  app.innerHTML = `
    <section class="modal-screen">
      <form id="first-month-form" class="modal">
        <strong>FIRST MONTH</strong>
        <h2>Salary first</h2>
        <p>Enter this month's salary once, then every entry subtracts from it.</p>
        <input name="name" value="${monthName()}" required />
        <input name="salary" inputmode="numeric" placeholder="salary in PKR" required autofocus />
        <button class="primary" type="submit">Start Tracking</button>
      </form>
    </section>
  `;
}

function header() {
  return `
    <header class="topbar">
      <div class="brand">EXPENSE_AI</div>
    </header>
  `;
}

function renderAuth() {
  const localMode = !db.configured;
  const isSignin = state.authMode === "signin";
  app.innerHTML = `
    <section class="auth-screen">
      <div class="auth-card">
        <div class="brand auth-brand">EXPENSE_AI</div>
        <h1>${isSignin ? "Sign in" : "Create login"}</h1>
        ${localMode ? `<div class="auth-banner">Local test mode — connect Supabase for your real account. See README.</div>` : ""}
        ${state.authNotice ? `<div class="auth-notice">${escapeHtml(state.authNotice)}</div>` : ""}
        ${state.authError ? `<div class="auth-error">${escapeHtml(state.authError)}</div>` : ""}
        <form id="auth-form" class="stack">
          <input name="email" type="email" autocomplete="email" inputmode="email" autocapitalize="none" placeholder="email" required />
          <input name="password" type="password" autocomplete="${isSignin ? "current-password" : "new-password"}" placeholder="password (6+ characters)" required />
          <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>
            ${state.busy ? "Please wait…" : isSignin ? "Enter" : "Create"}
          </button>
        </form>
        <button class="text-button" data-action="toggle-auth">
          ${isSignin ? "Need a login? Create one" : "Already have one? Sign in"}
        </button>
      </div>
    </section>
  `;
}

function renderInput() {
  const month = activeMonth();
  const status = state.listening
    ? "Listening… say your expenses, then pause or say \u201Cthat\u2019s it\u201D"
    : state.parseStatus || "";
  app.innerHTML = `
    ${header()}
    <section class="input-screen">
      <button class="month-switch" data-action="history">${escapeHtml(month?.name || "No month")} \u2022 tap for history</button>
      <div class="entry-card">
        <button class="mic-btn ${state.listening ? "live" : ""}" data-action="voice" aria-label="Voice input">${icon("mic")}</button>
        <textarea id="entry" rows="2" autocomplete="off" autocapitalize="none" placeholder="example: haircut 1000"></textarea>
      </div>
      ${status ? `<p class="entry-status ${state.listening ? "live" : ""}">${escapeHtml(status)}</p>` : ""}
      <button class="primary add-btn" data-action="record" disabled>Add to sheet</button>
    </section>
  `;
  setTimeout(() => {
    const entry = document.querySelector("#entry");
    if (entry) {
      entry.focus();
      updateAddButton();
    }
  }, 50);
}

function updateAddButton() {
  const entry = document.querySelector("#entry");
  const btn = document.querySelector(".add-btn");
  if (!entry || !btn) return;
  const hasText = entry.value.trim().length > 0;
  btn.disabled = !hasText || state.busy;
}

function renderSuccess() {
  const result = state.lastResult || { items: [] };
  const total = result.items.reduce((sum, tx) => sum + tx.amount, 0);
  const names = result.items.map((tx) => tx.title).join(", ");
  const month = state.months.find((item) => item.id === result.monthId) || activeMonth();
  app.innerHTML = `
    <section class="success-screen">
      <div class="check">${icon("check")}</div>
      <h1>Expenses recorded</h1>
      <p>Your AI analyst has successfully processed the new entries.</p>
      <div class="summary-strip">
        <div class="strip-icon">${icon("basket")}</div>
        <div>
          <strong>ADDED CATEGORY</strong>
          <span>${names || "Entries"}</span>
        </div>
        <b>${fmt(total)}</b>
      </div>
      <p class="success-month">${escapeHtml(month?.name || "")}</p>
      <button class="done" data-action="input">Done</button>
      <button class="hint" data-action="input">Tap anywhere to dismiss</button>
    </section>
  `;
}

function renderMissingMonth() {
  const item = state.pendingMonth;
  app.innerHTML = `
    <section class="modal-screen">
      <form id="missing-month-form" class="modal">
        <strong>MONTH NOT FOUND</strong>
        <h2>${escapeHtml(item.name)}</h2>
        <p>I can create this month and add the entry there.</p>
        <input name="salary" inputmode="numeric" placeholder="salary for this month in PKR" required autofocus />
        <div class="choice-row">
          <button class="primary" type="submit">Create</button>
          <button class="secondary" type="button" data-action="cancel-pending-month">Cancel</button>
        </div>
      </form>
    </section>
  `;
}

function renderClarification() {
  const item = state.pendingClarification;
  app.innerHTML = `
    <section class="modal-screen">
      <div class="modal">
        <strong>Quick check</strong>
        <h2>${item.title} ${fmt(item.amount)}</h2>
        <p>${item.reason || "Was this money received or sent?"}</p>
        <div class="choice-row">
          <button class="primary" data-action="clarify-received">Received</button>
          <button class="secondary" data-action="clarify-sent">Sent</button>
        </div>
      </div>
    </section>
  `;
}

function renderHistory() {
  const month = activeMonth();
  const sum = totals();
  const txs = monthTransactions();
  const budgetPercent = sum.salary + sum.received > 0 ? Math.max(0, Math.min(100, (sum.remaining / (sum.salary + sum.received)) * 100)) : 0;
  app.innerHTML = `
    ${header()}
    <section class="history-screen">
      <div class="balance">
        <label>Remaining Balance</label>
        <h1>${fmt(sum.remaining)}</h1>
        <p>OF ${fmt(sum.salary + sum.received)} BUDGET</p>
        <div class="bar"><span style="width:${budgetPercent}%"></span></div>
      </div>
      <div class="month-picker">
        <label class="field-label">Select month</label>
        <select id="month-select" aria-label="Select month">
          ${state.months.map((item) => `<option value="${item.id}" ${item.id === month?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select>
        <div class="month-actions">
          <button class="secondary compact" data-action="edit-month">${icon("edit")}<span>Edit salary</span></button>
          <button class="secondary compact" data-action="new-month">${icon("plus")}<span>New month</span></button>
        </div>
      </div>
      <div class="stats">
        <span>Salary <b>${fmt(sum.salary)}</b></span>
        <span>Received <b>${fmt(sum.received)}</b></span>
        <span>Spent <b>${fmt(sum.spent)}</b></span>
      </div>
      <section class="table-card">
        <div class="table-head"><span>TRANSACTION</span><span>CATEGORY</span><span>DATE</span></div>
        <div class="rows">
          ${txs.length ? txs.map(row).join("") : `<div class="empty">No entries yet</div>`}
        </div>
      </section>
      <button class="text-button signout-link" data-action="signout">Sign out</button>
      <nav class="dock">
        <button data-action="input" aria-label="Add entries">${icon("plus-circle")}</button>
        <button data-action="open-export" aria-label="Export a month">${icon("download")}</button>
      </nav>
    </section>
  `;
}

function row(tx) {
  const date = new Date(tx.created_at);
  const incoming = ["income", "loan_received"].includes(tx.kind);
  const sign = incoming ? "+" : "-";
  return `
    <article class="tx-row">
      <div class="tx-title">
        <span class="tx-icon ${incoming ? "in" : "out"}">${icon(categoryIcon(tx.category))}</span>
        <span class="tx-name">${escapeHtml(tx.title)}<small class="amt ${incoming ? "in" : "out"}">${sign}${fmt(tx.amount)}</small></span>
      </div>
      <span class="pill">${escapeHtml(tx.category)}</span>
      <time>${date.toLocaleDateString("en", { month: "short", day: "numeric" })}</time>
    </article>
  `;
}

function renderExportPicker() {
  const selected = state.exportPickerMonthId || activeMonth()?.id || state.months[0]?.id;
  app.innerHTML = `
    <section class="modal-screen">
      <div class="modal">
        <strong>EXPORT TO EXCEL</strong>
        <h2>Which month?</h2>
        <p>Pick a month to download its sheet as an .xlsx file.</p>
        <label class="field-label">Month</label>
        <select id="export-select" aria-label="Month to export">
          ${state.months.map((item) => `<option value="${item.id}" ${item.id === selected ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select>
        <div class="choice-row">
          <button class="primary" data-action="export-confirm">Download</button>
          <button class="secondary" data-action="export-cancel">Cancel</button>
        </div>
      </div>
    </section>
  `;
}

function renderNewMonth() {
  const month = activeMonth();
  const editing = state.view === "edit-month";
  app.innerHTML = `
    <section class="modal-screen">
      <form id="month-form" class="modal">
        <strong>${editing ? "EDIT MONTH" : "NEW MONTH"}</strong>
        <input name="name" value="${editing ? escapeHtml(month?.name || monthName()) : monthName()}" required />
        <input name="salary" inputmode="numeric" placeholder="salary in PKR" value="${editing ? Number(month?.salary || 0) : ""}" required />
        <button class="primary" type="submit">${editing ? "Save" : "Create"}</button>
        <button class="secondary" type="button" data-action="history">Cancel</button>
      </form>
    </section>
  `;
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) {
    if (state.view === "success") {
      state.view = "input";
      render();
    }
    return;
  }
  const action = target.dataset.action;
  const chip = target.dataset.chip;
  if (chip) document.querySelector("#entry").value = chip;
  if (action === "toggle-auth") {
    state.authMode = state.authMode === "signin" ? "signup" : "signin";
    state.authError = "";
    state.authNotice = "";
    render();
  }
  if (action === "signout") {
    localStorage.removeItem("expense_ai_session");
    Object.assign(state, { session: null, user: null, view: "input" });
    render();
  }
  if (action === "history") {
    state.view = "history";
    render();
  }
  if (action === "input") {
    state.view = "input";
    state.parseStatus = "";
    render();
  }
  if (action === "new-month") renderNewMonth();
  if (action === "edit-month") {
    state.view = "edit-month";
    renderNewMonth();
  }
  if (action === "cancel-pending-month") {
    state.pendingMonth = null;
    state.view = "input";
    render();
  }
  if (action === "open-export") {
    state.exportPickerMonthId = activeMonth()?.id || state.months[0]?.id || "";
    render();
  }
  if (action === "export-cancel") {
    state.exportPickerMonthId = null;
    render();
  }
  if (action === "export-confirm") {
    const sel = document.querySelector("#export-select");
    const id = sel?.value || state.exportPickerMonthId;
    state.exportPickerMonthId = null;
    render();
    exportMonth(id);
  }
  if (action === "record") {
    const entry = document.querySelector("#entry");
    if (entry) await submitEntry(entry.value);
  }
  if (action === "voice") startVoice();
  if (action === "clarify-received") resolveClarification("loan_received");
  if (action === "clarify-sent") resolveClarification("loan_sent");
});

app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (event.target.id === "auth-form") {
    await submitAuth(event.target);
  }
  if (event.target.id === "first-month-form") {
    await createMonth(event.target, { first: true });
  }
  if (event.target.id === "month-form") {
    await createMonth(event.target);
  }
  if (event.target.id === "missing-month-form") {
    await createPendingMonth(event.target);
  }
});

app.addEventListener("input", (event) => {
  if (event.target.id === "entry") updateAddButton();
});

app.addEventListener("change", (event) => {
  if (event.target.id === "month-select") {
    state.activeMonthId = event.target.value;
    render();
  }
});

app.addEventListener("keydown", async (event) => {
  if (event.key === "Enter" && event.target.id === "entry" && !event.shiftKey) {
    event.preventDefault();
    await submitEntry(event.target.value);
  }
});

async function submitAuth(form) {
  const email = form.email.value.trim();
  const password = form.password.value;
  state.authError = "";
  state.authNotice = "";
  if (password.length < 6) {
    state.authError = "Password must be at least 6 characters.";
    render();
    return;
  }
  state.busy = true;
  render();
  try {
    const result =
      state.authMode === "signin"
        ? await db.signIn(email, password)
        : await db.signUp(email, password);

    // A valid login always carries an access_token. If a sign-up comes
    // back without one, Supabase has email confirmation switched on and
    // is waiting for the user to click the link in their inbox.
    if (!result?.access_token) {
      state.authMode = "signin";
      state.authNotice =
        "Account created. If asked, confirm via the email Supabase sent, then sign in. " +
        "(For a personal app you can turn confirmation off in Supabase → Authentication.)";
      state.busy = false;
      render();
      return;
    }

    state.session = result;
    state.user = result.user;
    store.write("expense_ai_session", result);
    await loadData();
    state.view = "input";
  } catch (error) {
    state.authError = friendlyAuthError(error);
  } finally {
    state.busy = false;
    render();
  }
}

function friendlyAuthError(error) {
  const message = String(error?.message || "");
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/already registered|already exists|user already/i.test(message)) {
    return "That email already has an account. Try signing in instead.";
  }
  if (/email/i.test(message) && /invalid/i.test(message)) return "That email address looks invalid.";
  if (!error?.status) return "Could not reach the server. Check your connection and try again.";
  return message || "Something went wrong. Please try again.";
}

async function createMonth(form, options = {}) {
  const current = state.view === "edit-month" || options.first ? activeMonth() : null;
  const month = {
    id: current?.id || uid(),
    name: form.name.value.trim(),
    salary: parseAmount(form.salary.value),
    created_at: current?.created_at || todayISO(),
    user_id: state.user?.id || "local"
  };
  await db.saveMonth(month);
  state.activeMonthId = month.id;
  state.view = options.first ? "input" : "history";
  render();
}

async function createPendingMonth(form) {
  const pending = state.pendingMonth;
  const month = {
    id: uid(),
    name: pending.name,
    salary: parseAmount(form.salary.value),
    created_at: todayISO(),
    user_id: state.user?.id || "local"
  };
  await db.saveMonth(month);
  state.activeMonthId = month.id;
  state.pendingMonth = null;
  await recordItems(pending.items, month.id);
}

async function submitEntry(text) {
  text = text.trim();
  if (!text) return;
  state.busy = true;
  state.parseStatus = "Reading your entry…";
  render();
  try {
    const parsed = await parseEntry(text);
    state.busy = false;
    state.parseStatus = "";
    if (parsed.clarifications?.length) {
      state.pendingClarification = parsed.clarifications[0];
      render();
      return;
    }
    const items = parsed.items || [];
    if (!items.length) {
      state.parseStatus = "This app records expenses. Try e.g. \u201Cgroceries 2000\u201D or \u201Creceived 5000 salary\u201D.";
      render();
      return;
    }
    const targetMonth = resolveTargetMonth(items);
    if (targetMonth.missing) {
      state.pendingMonth = { name: targetMonth.name, items };
      render();
      return;
    }
    await recordItems(items, targetMonth.id);
  } catch (error) {
    state.busy = false;
    state.parseStatus = "Could not save. Check your connection and try again.";
    render();
  }
}

async function parseEntry(text) {
  const quick = quickParse(text);
  if (quick.confident) return { items: quick.items, clarifications: quick.clarifications };
  try {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, people: knownPeople(), months: state.months.map((month) => month.name) })
    });
    if (res.ok) return await res.json();
  } catch {}
  return { items: quick.items, clarifications: quick.clarifications };
}

const STOPWORDS = new Set(["a", "an", "the", "of", "at", "for", "on", "in", "to", "with", "from", "and", "my", "me", "i", "was", "is", "rs", "pkr", "rupees", "rupee", "paisa", "this", "that", "add"]);
const TITLE_VERBS = new Set(["spent", "spend", "paid", "pay", "sent", "send", "gave", "give", "returned", "return", "received", "recieved", "receive", "got", "get", "income"]);

function cleanWords(words, dropVerbs = true) {
  return words
    .map((word) => word.toLowerCase().replace(/[^a-z']/g, ""))
    .filter((word) => word && !STOPWORDS.has(word) && (!dropVerbs || !TITLE_VERBS.has(word)));
}

function quickParse(text) {
  const targetMonthName = extractMonthName(text);
  const withoutMonth = targetMonthName ? stripMonthPhrase(text, targetMonthName) : text;
  // Join thousands separators ("4,500" -> "4500") before turning commas into spaces.
  const cleaned = withoutMonth.toLowerCase().replace(/(\d),(\d)/g, "$1$2").replace(/,/g, " ");
  const hasVerb = /\b(received|recieved|got|income|salary|paid|sent|gave|returned)\b/.test(cleaned);

  const spentOn = cleaned.match(/\b(?:spent|paid|sent|gave)\s+(?:rs\.?\s*)?(\d+(?:\.\d+)?k?)\s+(?:on|for|to)\s+([a-z][a-z\s]{1,40})\b/i);
  if (spentOn) {
    const title = titleCase(spentOn[2].replace(/\b(in|to|for|on)$/i, "").trim());
    const amount = parseAmount(spentOn[1]);
    const kind = inferPerson(title) ? "loan_sent" : "expense";
    return {
      items: [{ kind, title, amount, category: inferCategory(title, kind), person: inferPerson(title), targetMonthName, confidence: 0.82 }],
      clarifications: [],
      confident: true
    };
  }

  // Single number anywhere in a short phrase: everything else becomes the title.
  // Handles "lunch 1500 at cafe", "2000 groceries", "office party 5000", etc.
  const numbers = cleaned.match(/\b\d+(?:\.\d+)?k?\b/gi) || [];
  if (numbers.length === 1) {
    const amount = parseAmount(numbers[0]);
    if (amount) {
      const rest = cleaned.replace(numbers[0], " ").split(/\s+/);
      const meaningful = cleanWords(rest, true);
      const fallback = cleanWords(rest, false);
      const title = titleCase((meaningful.length ? meaningful : fallback).join(" ")) || "Expense";
      const person = inferPerson(title) || inferPerson(titleCase(fallback.join(" ")));
      if (person && !hasVerb) {
        return {
          items: [],
          clarifications: [{ title: titleCase(person), amount, person, targetMonthName, reason: "Was this money received or sent?" }],
          confident: true
        };
      }
      const kind = inferKind(cleaned, title);
      return {
        items: [{ kind, title, amount, category: inferCategory(title, kind), person: person || null, targetMonthName, confidence: 0.8 }],
        clarifications: [],
        confident: true
      };
    }
  }

  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const items = [];
  const clarifications = [];
  let label = [];

  for (const token of tokens) {
    const amount = parseAmount(token);
    if (amount && label.length) {
      const title = titleCase(label.join(" "));
      const kind = inferKind(cleaned, title);
      const person = inferPerson(title);
      if (person && !hasVerb) {
        clarifications.push({ title, amount, person, targetMonthName, reason: "Was this money received or sent?" });
      } else {
        items.push({ kind, title, amount, category: inferCategory(title, kind), person, targetMonthName, confidence: 0.86 });
      }
      label = [];
    } else {
      label.push(token);
    }
  }
  // Trailing words after the last amount: attach a name to an income/loan row,
  // or extra description to a single expense, so nothing is silently dropped.
  if (label.length && items.length === 1) {
    const last = items[0];
    const person = inferPerson(titleCase(label.join(" ")));
    if (person && !last.person && ["income", "loan_received", "loan_sent"].includes(last.kind)) {
      last.person = person;
      last.title = `${last.title} ${titleCase(person)}`.trim();
    } else if (last.kind === "expense") {
      const extra = cleanWords(label, true);
      if (extra.length) last.title = `${last.title} ${titleCase(extra.join(" "))}`.trim();
    }
  }
  return { items, clarifications, confident: items.length > 0 || clarifications.length > 0 };
}

function extractMonthName(text) {
  const months = "january february march april may june july august september october november december";
  const match = text.match(new RegExp(`\\b(${months.replaceAll(" ", "|")})\\s+(20\\d{2})\\b`, "i"));
  if (!match) return null;
  return titleCase(`${match[1]} ${match[2]}`);
}

function stripMonthPhrase(text, month) {
  return text.replace(new RegExp(`\\b(?:add\\s+this\\s+(?:in|to)\\s+|in\\s+|to\\s+)?${month.replace(" ", "\\s+")}\\b`, "i"), " ");
}

function resolveTargetMonth(items) {
  const requested = items.map((item) => item.targetMonthName).find(Boolean);
  if (!requested) return { id: activeMonth()?.id };
  const found = state.months.find((month) => normalizeMonth(month.name) === normalizeMonth(requested));
  if (found) return { id: found.id };
  return { missing: true, name: requested };
}

function normalizeMonth(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseAmount(raw) {
  const normalized = String(raw).toLowerCase().replace(/[^\d.k]/g, "");
  if (!normalized) return 0;
  if (normalized.endsWith("k")) return Number(normalized.slice(0, -1)) * 1000;
  return Number(normalized);
}

function inferKind(text, title) {
  if (/\b(received|recieved|got|income|salary)\b/.test(text)) return "income";
  if (/\b(sent|gave|paid|returned)\b/.test(text) && inferPerson(title)) return "loan_sent";
  return "expense";
}

function inferPerson(title) {
  const words = title.toLowerCase().split(/\s+/);
  const known = knownPeople().map((person) => person.toLowerCase());
  return words.find((word) => known.includes(word)) || null;
}

function knownPeople() {
  const fromTx = state.transactions.map((tx) => tx.person).filter(Boolean);
  return [...new Set([...fromTx, "faran", "ammi", "abba", "mama", "papa", "brother", "sister"])];
}

function inferCategory(title, kind) {
  if (kind === "income" || kind === "loan_received") return "Received";
  if (kind === "loan_sent") return "Loan Return";
  const lower = title.toLowerCase();
  const found = categories.find(([, , words]) => words.some((word) => lower.includes(word)));
  return found?.[1] || "Other";
}

async function resolveClarification(kind) {
  const item = state.pendingClarification;
  state.pendingClarification = null;
  await recordItems([{ kind, title: item.title, amount: item.amount, category: kind === "loan_received" ? "Received" : "Loan Return", person: item.person, targetMonthName: item.targetMonthName, confidence: 1 }]);
}

async function recordItems(items, monthId = activeMonth()?.id) {
  const month = state.months.find((item) => item.id === monthId) || activeMonth();
  const rows = items.map((item) => ({
    id: uid(),
    month_id: month.id,
    user_id: state.user?.id || "local",
    kind: item.kind || "expense",
    title: titleCase(item.title),
    amount: Number(item.amount),
    category: item.category || inferCategory(item.title, item.kind),
    person: item.person || null,
    raw_text: item.raw_text || null,
    created_at: todayISO()
  }));
  if (!rows.length) return;
  await db.saveTransactions(rows);
  state.activeMonthId = month.id;
  state.lastResult = { items: rows, monthId: month.id };
  state.view = "success";
  render();
}

let activeRecognition = null;

function startVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    state.parseStatus = "Voice isn\u2019t supported in this browser \u2014 please type instead.";
    render();
    return;
  }
  // Tapping the mic again while listening stops it.
  if (state.listening) {
    stopVoice();
    return;
  }

  const recognition = new SpeechRecognition();
  activeRecognition = recognition;
  recognition.lang = "en-PK";
  recognition.continuous = false; // auto-stops shortly after you stop talking
  recognition.interimResults = true;

  let finalText = "";
  state.listening = true;
  state.parseStatus = "";
  render();

  const writeField = (value) => {
    const entry = document.querySelector("#entry");
    if (entry) {
      entry.value = value;
      updateAddButton();
    }
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += `${chunk} `;
      else interim += chunk;
    }
    const combined = `${finalText}${interim}`.trim();
    writeField(combined);
    // Stop phrase: "that's it" / "thats it"
    if (/\bthat'?s it\b/i.test(combined)) {
      try { recognition.stop(); } catch {}
    }
  };

  recognition.onerror = () => {
    // Errors (no-speech, denied, network) fall through to onend.
  };

  recognition.onend = async () => {
    state.listening = false;
    activeRecognition = null;
    const field = document.querySelector("#entry");
    let text = (finalText || field?.value || "").trim();
    text = text.replace(/\bthat'?s it\b/ig, "").trim();
    if (text) {
      writeField(text);
      await submitEntry(text);
    } else {
      state.parseStatus = "Didn\u2019t catch that \u2014 please say your expenses, e.g. \u201Cgroceries 2000\u201D.";
      render();
    }
  };

  try {
    recognition.start();
  } catch {
    state.listening = false;
    activeRecognition = null;
    render();
  }
}

function stopVoice() {
  if (activeRecognition) {
    try { activeRecognition.stop(); } catch {}
  }
}

function exportMonth(monthId) {
  const month = state.months.find((item) => item.id === monthId) || activeMonth();
  if (!month) return;
  const rows = [
    ["Month", month.name],
    ["Salary", month.salary],
    [],
    ["Date", "Type", "Transaction", "Category", "Person", "Amount PKR"],
    ...state.transactions
      .filter((tx) => tx.month_id === month.id)
      .map((tx) => [
        new Date(tx.created_at).toLocaleDateString("en-PK"),
        tx.kind,
        tx.title,
        tx.category,
        tx.person || "",
        tx.amount
      ])
  ];
  const blob = xlsxBlob(rows);
  download(blob, `${month.name.replace(/\s+/g, "-").toLowerCase()}-expenses.xlsx`);
}

function xlsxBlob(rows) {
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Expenses" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": worksheetXml(rows)
  };
  return new Blob([zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function worksheetXml(rows) {
  const sheetData = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => {
          const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(String(cell ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`;
}

function zipStore(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = concatBytes(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes, data
    );
    localParts.push(local);
    centralParts.push(concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc),
      u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset), nameBytes
    ));
    offset += local.length;
  });

  const central = concatBytes(...centralParts);
  const end = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(centralParts.length), u16(centralParts.length),
    u32(central.length), u32(offset), u16(0)
  );
  return concatBytes(...localParts, central, end);
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concatBytes(...parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function titleCase(text) {
  return String(text || "").replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function xmlEscape(text) {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function categoryIcon(category) {
  const key = String(category || "").toLowerCase();
  if (key.includes("dining")) return "fork";
  if (key.includes("transport")) return "fuel";
  if (key.includes("util")) return "bolt";
  if (key.includes("received")) return "arrow-down";
  if (key.includes("loan")) return "user";
  return "bag";
}

function icon(name) {
  const icons = {
    menu: '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    mic: '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></svg>',
    history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    basket: '<svg viewBox="0 0 24 24"><path d="m6 8 6-6 6 6M4 10h16l-2 10H6L4 10Z"/><path d="M9 14v3M15 14v3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    "plus-circle": '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
    table: '<svg viewBox="0 0 24 24"><path d="M4 5h16v16H4zM4 11h16M10 5v16"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    fork: '<svg viewBox="0 0 24 24"><path d="M6 3v8M10 3v8M6 7h4M8 11v10M17 3v18M14 7c0-2 3-4 3-4"/></svg>',
    fuel: '<svg viewBox="0 0 24 24"><path d="M5 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M4 21h13M8 7h5v4H8z"/><path d="m16 8 3 3v6a2 2 0 0 0 4 0v-5l-3-3"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="m13 2-9 13h8l-1 7 9-13h-8l1-7Z"/></svg>',
    bag: '<svg viewBox="0 0 24 24"><path d="M6 8h16l-2 13H8L6 8Z"/><path d="M10 8a4 4 0 0 1 8 0"/></svg>',
    "arrow-down": '<svg viewBox="0 0 24 24"><path d="M12 3v15M6 12l6 6 6-6"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M20 21a8 8 0 1 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>'
  };
  return icons[name] || icons.bag;
}

boot();
