<script lang="ts">
	import { goto } from '$app/navigation';
	import AppDialog from '$lib/components/AppDialog.svelte';
	import defaultMenuData from '$lib/assets/data/menu.json';
	import { calculateExactBudgetGacha, type ExactBudgetSelection } from '$lib/gacha';
	import { filterMenuForServicePeriod, getMenuServicePeriod } from '$lib/menu-availability';
	import { isAlcoholMenuItem } from '$lib/menu-classification';
	import { matchesMenuSearch } from '$lib/menu-search';
	import { onMount } from 'svelte';

	type MenuItem = {
		code: string;
		name: string;
		kana: string;
		price: number;
		category: string;
		tags: string[];
		imageUrl: string | null;
		alcoholCheck?: number;
		source?: 'official' | 'seed';
	};

	type CartItem = {
		id: string;
		name?: string;
		price?: number;
		count: number;
	};

	type AccountLine = {
		name: string;
		count: number;
		price: number;
	};

	type AccountSummary = {
		lines: AccountLine[];
		count: number;
		total: number;
	};

	type ClientState = {
		baseURL?: string;
		nextId: string;
		shopId: number;
		tableNo: number;
		peopleCount: number;
		pageKind: string;
		cart: CartItem[];
	};

	type OfficialSessionSnapshot = {
		id: string;
		state: ClientState & { baseURL: string };
		cookies: [string, string][];
		createdAt: number;
		updatedAt: number;
	};

	type CheckoutPresentation = {
		state: ClientState;
		account: AccountSummary;
		barcodeValue: string;
		barcodeImageSrc?: string;
		receiptShown: boolean;
	};

	type LookupItemResult = {
		result: string;
		alcohol_check?: number;
		item_data?: {
			id: string;
			name: string;
			price: number;
			state: number;
		};
	};

	type DefaultMenuEntry = {
		code: string;
		name: string;
		kana?: string;
		price?: number;
		category?: string;
		tags?: string[];
		imageUrl?: string | null;
		alcoholCheck?: number;
	};

	type ActiveTab = 'add' | 'cart' | 'history' | 'call' | 'checkout';
	type MenuStatus = 'unchecked' | 'loading' | 'available' | 'unavailable' | 'error';

	const menuImageModules = import.meta.glob('../../../lib/assets/image/*.webp', {
		eager: true,
		query: '?url',
		import: 'default'
	}) as Record<string, string>;
	const menuCoverImages = Object.fromEntries(
		Object.entries(menuImageModules)
			.map(([file, source]) => [file.match(/\/([^/]+)\.webp$/)?.[1], source])
			.filter((entry): entry is [string, string] => Boolean(entry[0]))
	);

	const normalizeDefaultMenu = (entries: DefaultMenuEntry[]) =>
		entries
			.map((entry): MenuItem | null => {
				const code = String(entry.code ?? '').trim();
				const name = String(entry.name ?? '').trim();
				if (!/^\d{4}$/.test(code) || !name) {
					return null;
				}
				return {
					code,
					name,
					kana: entry.kana ?? name,
					price: Number(entry.price ?? 0),
					category: entry.category ?? 'メニュー',
					tags: entry.tags ?? [],
					imageUrl: entry.imageUrl ?? null,
					...(entry.alcoholCheck !== undefined && { alcoholCheck: entry.alcoholCheck }),
					source: 'seed'
				};
			})
			.filter((item): item is MenuItem => item !== null);

	const defaultMenuItems = normalizeDefaultMenu(defaultMenuData as DefaultMenuEntry[]);

	let { data } = $props<{ data: { sessionId: string } }>();

	const sessionId = $derived(data.sessionId);

	let clientState = $state<ClientState | null>(null);
	let officialSession = $state<OfficialSessionSnapshot | null>(null);
	let checkout = $state<CheckoutPresentation | null>(null);
	let menu = $state<MenuItem[]>(defaultMenuItems);
	let menuStatuses = $state<Record<string, MenuStatus>>(
		Object.fromEntries(defaultMenuItems.map((item) => [item.code, 'unchecked' as MenuStatus]))
	);
	let menuDetectionSeq = $state<Record<string, number>>({});
	let currentMenuPeriod = $state(getMenuServicePeriod());
	let localCart = $state<CartItem[]>([]);
	let selectedCategory = $state('すべて');
	let search = $state('');
	let manualCode = $state('');
	let toast = $state('');
	let error = $state('');
	let busy = $state(false);
	let activeTab = $state<ActiveTab>('add');
	let gachaDialogOpen = $state(false);
	let gachaResults = $state<ExactBudgetSelection<MenuItem>[]>([]);
	let gachaBudget = $state(1000);
	let gachaCount = $state(0n);
	let gachaHasRun = $state(false);
	let excludeAlcoholFromGacha = $state(false);

	const cartStorageKey = $derived(`betterzeriya:${sessionId}:cart`);
	const officialSessionStorageKey = $derived(`betterzeriya:${sessionId}:official-session`);
	const serviceMenu = $derived(filterMenuForServicePeriod(menu, currentMenuPeriod));
	const categories = $derived(['すべて', ...new Set(serviceMenu.map((item) => item.category))]);
	const filteredMenu = $derived(
		serviceMenu.filter((item) => {
			const categoryMatch = selectedCategory === 'すべて' || item.category === selectedCategory;
			const queryMatch = matchesMenuSearch(item, search);
			return categoryMatch && queryMatch;
		})
	);

	const totalCount = $derived(localCart.reduce((sum: number, item: CartItem) => sum + item.count, 0));
	const totalPrice = $derived(
		localCart.reduce((sum: number, item: CartItem) => sum + (item.price ?? 0) * item.count, 0)
	);
	const canOrder = $derived(Boolean(clientState && totalCount > 0 && !busy));
	const accountCount = $derived(checkout?.account.count ?? 0);
	const accountTotal = $derived(checkout?.account.total ?? 0);
	const tabItems = $derived([
		{ id: 'add' as const, label: '注文追加', icon: 'i-tabler-plus' },
		{ id: 'cart' as const, label: '注文かご', icon: 'i-tabler-shopping-cart', count: totalCount },
		{ id: 'history' as const, label: '注文履歴', icon: 'i-tabler-history' },
		{ id: 'call' as const, label: '店員呼出', icon: 'i-tabler-bell' },
		{ id: 'checkout' as const, label: '会計', icon: 'i-tabler-receipt' }
	]);

	const notify = (message: string) => {
		toast = message;
		window.setTimeout(() => {
			if (toast === message) {
				toast = '';
			}
		}, 2800);
	};

	const saveOfficialSession = (snapshot: OfficialSessionSnapshot) => {
		officialSession = snapshot;
		sessionStorage.setItem(officialSessionStorageKey, JSON.stringify(snapshot));
	};

	const restoreOfficialSession = () => {
		const raw = sessionStorage.getItem(officialSessionStorageKey);
		if (!raw) {
			return;
		}
		try {
			const parsed = JSON.parse(raw) as OfficialSessionSnapshot;
			if (parsed.id === sessionId && parsed.state?.baseURL && Array.isArray(parsed.cookies)) {
				officialSession = parsed;
			}
		} catch {
			sessionStorage.removeItem(officialSessionStorageKey);
		}
	};

	const statusLabel = (status: MenuStatus | undefined) => {
		if (status === 'available') {
			return '注文可';
		}
		if (status === 'unavailable') {
			return '注文不可';
		}
		if (status === 'error') {
			return '確認失敗';
		}
		if (status === 'loading') {
			return '確認中';
		}
		return '未確認';
	};

	async function requestJSON<T>(path: string, body?: unknown): Promise<T> {
		busy = true;
		error = '';
		try {
			const response = await fetch(path, {
				method: body ? 'POST' : 'GET',
				headers: body ? { 'content-type': 'application/json' } : undefined,
				body: body ? JSON.stringify(body) : undefined
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload.error ?? 'Request failed');
			}
			if (payload.officialSession) {
				saveOfficialSession(payload.officialSession as OfficialSessionSnapshot);
			}
			return payload as T;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : '通信に失敗しました';
			throw caught;
		} finally {
			busy = false;
		}
	}

	const loadState = async () => {
		try {
			const result = await requestJSON<{ state: ClientState; officialSession: OfficialSessionSnapshot }>(
				`/api/sessions/${sessionId}`,
				{ officialSession }
			);
			clientState = result.state;
		} catch {}
	};

	const setMenuStatus = (code: string, status: MenuStatus, seq: number) => {
		if (menuDetectionSeq[code] !== seq) {
			return;
		}
		menuStatuses = { ...menuStatuses, [code]: status };
	};

	const nextMenuDetectionSeq = (code: string) => {
		const seq = (menuDetectionSeq[code] ?? 0) + 1;
		menuDetectionSeq = { ...menuDetectionSeq, [code]: seq };
		return seq;
	};

	const lookupOfficialMenuItem = async (code: string) => {
		const response = await fetch(`/api/sessions/${sessionId}/lookup`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ code, officialSession })
		});
		const result = (await response.json()) as LookupItemResult & {
			error?: string;
			officialSession?: OfficialSessionSnapshot;
		};
		if (!response.ok) {
			throw new Error(result.error ?? 'Request failed');
		}
		if (result.officialSession) {
			saveOfficialSession(result.officialSession as OfficialSessionSnapshot);
		}
		if (result.result !== 'OK' || !result.item_data || result.item_data.state === 0) {
			throw new Error(`メニュー番号 ${code} は利用できません`);
		}

		return {
			code,
			name: result.item_data.name,
			kana: result.item_data.name,
			price: result.item_data.price,
			category: menu.find((item) => item.code === code)?.category ?? '入力済み',
			tags: [...new Set([...(menu.find((item) => item.code === code)?.tags ?? []), '公式確認済み'])],
			imageUrl: menu.find((item) => item.code === code)?.imageUrl ?? null,
			alcoholCheck: result.alcohol_check,
			source: 'official'
		} satisfies MenuItem;
	};

	const upsertMenuItem = (item: MenuItem) => {
		const existing = menu.find((entry) => entry.code === item.code);
		menu = existing
			? menu.map((entry) => (entry.code === item.code ? { ...entry, ...item } : entry))
			: [...menu, item];
	};

	const detectMenuItem = async (code: string, priority = false) => {
		const seq = nextMenuDetectionSeq(code);
		menuStatuses = { ...menuStatuses, [code]: 'loading' };
		try {
			const item = await lookupOfficialMenuItem(code);
			upsertMenuItem(item);
			setMenuStatus(code, 'available', seq);
			return item;
		} catch (caught) {
			const message = caught instanceof Error ? caught.message : '通信に失敗しました';
			setMenuStatus(code, message.includes('利用できません') ? 'unavailable' : 'error', seq);
			if (priority) {
				if (message.includes('利用できません')) {
					notify(message);
				} else {
					error = message;
				}
			}
			throw caught;
		}
	};

	const saveCart = () => {
		if (localCart.length === 0) {
			sessionStorage.removeItem(cartStorageKey);
			return;
		}
		sessionStorage.setItem(cartStorageKey, JSON.stringify(localCart));
	};

	const commitCart = (nextCart: CartItem[]) => {
		localCart = nextCart;
		checkout = null;
		saveCart();
	};

	const restoreCart = () => {
		const rawCart = sessionStorage.getItem(cartStorageKey);
		if (!rawCart) {
			return;
		}

		try {
			const parsed = JSON.parse(rawCart);
			if (!Array.isArray(parsed)) {
				throw new Error('Invalid cart');
			}

			localCart = parsed
				.map((item) => {
					const id = String(item?.id ?? '').trim();
					const count = Number(item?.count ?? 1);
					const cartItem: CartItem = {
						id,
						name: item?.name ? String(item.name) : undefined,
						price: Number.isFinite(Number(item?.price)) ? Number(item.price) : 0,
						count
					};
					return cartItem;
				})
				.filter(
					(item) =>
						/^\d{4}$/.test(item.id) &&
						Number.isInteger(item.count) &&
						item.count > 0 &&
						item.count <= 99
				);
			saveCart();
		} catch {
			localCart = [];
			sessionStorage.removeItem(cartStorageKey);
		}
	};

	const addItem = async (item: MenuItem | string) => {
		try {
			const resolved = await detectMenuItem(typeof item === 'string' ? item : item.code, true);

			const current = localCart.find((cartItem) => cartItem.id === resolved.code);
			if (current?.count === 99) {
				error = '数量は 99 点までです';
				return;
			}

			commitCart(
				current
					? localCart.map((cartItem) =>
							cartItem.id === resolved.code
								? {
										...cartItem,
										name: resolved.name,
										price: resolved.price,
										count: cartItem.count + 1
									}
								: cartItem
						)
					: [
							...localCart,
							{ id: resolved.code, name: resolved.name, price: resolved.price, count: 1 }
						]
			);
			notify(`${resolved.name} をカートに入れました`);
		} catch {}
	};

	const addManualCode = async () => {
		const code = manualCode.trim();
		if (!/^\d{4}$/.test(code)) {
			error = '4 桁のメニュー番号を入力してください。';
			return;
		}
		try {
			await addItem(code);
			manualCode = '';
		} catch {}
	};

	const removeItem = (index: number, item: CartItem) => {
		commitCart(localCart.filter((_, itemIndex) => itemIndex !== index));
		notify(`${item.name ?? item.id} を削除しました`);
	};

	const updateItemCount = (index: number, item: CartItem, count: number) => {
		if (!Number.isInteger(count)) {
			return;
		}
		if (count <= 0) {
			removeItem(index, item);
			return;
		}
		if (count > 99) {
			error = '数量は 99 点までです';
			return;
		}

		commitCart(
			localCart.map((cartItem, itemIndex) =>
				itemIndex === index ? { ...cartItem, count } : cartItem
			)
		);
	};

	const submitOrder = async () => {
		if (!canOrder) {
			return;
		}
		try {
			const result = await requestJSON<{ state: ClientState }>(`/api/sessions/${sessionId}/submit`, {
				officialSession,
				cart: localCart.map((item) => ({ id: item.id, count: item.count }))
			});
			clientState = result.state;
			commitCart([]);
			activeTab = 'history';
			notify('注文を公式システムへ送信しました');
			await loadAccount();
		} catch {}
	};

	const loadAccount = async () => {
		try {
			const result = await requestJSON<CheckoutPresentation>(`/api/sessions/${sessionId}/account`, {
				officialSession
			});
			checkout = result;
			clientState = result.state;
			notify('注文履歴を更新しました');
		} catch {}
	};

	const settleCheckout = async () => {
		try {
			const result = await requestJSON<CheckoutPresentation>(`/api/sessions/${sessionId}/receipt`, {
				officialSession
			});
			checkout = result;
			clientState = result.state;
			notify('会計を確定しました');
		} catch {}
	};

	const callStaff = async (after = false) => {
		try {
			await requestJSON(`/api/sessions/${sessionId}/call`, { after, officialSession });
			notify(after ? 'デザート呼出を送信しました' : '店員呼出を送信しました');
		} catch {}
	};

	const gachaPool = $derived(
		serviceMenu.filter(
			(item) =>
				item.price > 0 &&
				menuStatuses[item.code] !== 'unavailable'
		)
	);

	const runGacha = (budget = gachaBudget) => {
		if (!Number.isInteger(budget) || budget < 0) {
			error = '予算は 0 以上の整数で入力してください。';
			return;
		}

		const candidates = excludeAlcoholFromGacha
			? gachaPool.filter((item) => !isAlcoholMenuItem(item))
			: gachaPool;

		try {
			const result = calculateExactBudgetGacha(candidates, budget);
			gachaCount = result.count;
			gachaResults = result.sample ?? [];
			gachaHasRun = true;
				gachaDialogOpen = true;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'ガチャの計算に失敗しました';
		}
	};

	const addGachaToCart = async () => {
		const nextCart = [...localCart];

		for (const selection of gachaResults) {
			const current = nextCart.find((cartItem) => cartItem.id === selection.item.code);
			const nextCount = (current?.count ?? 0) + selection.quantity;
			if (nextCount > 99) {
				error = '数量は 99 点までです';
				return;
			}
		}

		for (const selection of gachaResults) {
			const current = nextCart.find((cartItem) => cartItem.id === selection.item.code);
			if (current) {
				current.name = selection.item.name;
				current.price = selection.item.price;
				current.count += selection.quantity;
			} else {
				nextCart.push({
					id: selection.item.code,
					name: selection.item.name,
					price: selection.item.price,
					count: selection.quantity
				});
			}
		}

		commitCart(nextCart);
		gachaDialogOpen = false;
		notify('ガチャ結果をカートに入れました');
	};

	onMount(() => {
		restoreOfficialSession();
		restoreCart();
		void loadState();
		const periodTimer = window.setInterval(() => {
			currentMenuPeriod = getMenuServicePeriod();
			if (!categories.includes(selectedCategory)) {
				selectedCategory = 'すべて';
			}
		}, 60_000);
		return () => window.clearInterval(periodTimer);
	});
</script>

<svelte:head>
	<title>注文 | Betterzeriya</title>
</svelte:head>

<main class="mx-auto grid w-[min(1180px,calc(100%_-_32px))] grid-cols-1 gap-y-0 px-4 pt-6 pb-28 text-slate-950 min-[901px]:w-[min(1240px,calc(100%_-_32px))] min-[901px]:grid-cols-[220px_minmax(0,1fr)] min-[901px]:gap-x-6 min-[901px]:pb-10">
	<header class="mb-5 grid items-center gap-3 min-[901px]:col-start-2 min-[561px]:grid-cols-[minmax(0,1fr)_auto_auto]">
		<div>
			<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">Order</p>
			<h1 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">注文</h1>
		</div>
		{#if clientState}
			<div class="flex flex-col gap-2 rounded-lg bg-green-50 p-3 text-green-800 min-[561px]:flex-row min-[561px]:items-center min-[561px]:justify-between">
				<span>Shop {clientState.shopId}</span>
				<strong>Table {clientState.tableNo}</strong>
				<span>{clientState.peopleCount} 名</span>
			</div>
		{/if}
		<div class="grid grid-cols-2 gap-2.5 min-[561px]:flex">
			<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={loadState} disabled={busy}>更新</button>
			<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" onclick={() => goto('/')}>QR</button>
		</div>
	</header>

	{#if error}
		<div class="sticky top-3 z-10 mb-3.5 rounded-lg bg-red-50 px-3.5 py-3 font-bold text-red-800 min-[901px]:col-start-2" role="alert">{error}</div>
	{/if}
	{#if toast}
		<div class="fixed top-[max(16px,env(safe-area-inset-top))] right-[max(16px,env(safe-area-inset-right))] z-20 w-[min(360px,calc(100%_-_32px))] rounded-lg bg-slate-950 px-3.5 py-3 font-bold text-white shadow-[0_18px_50px_rgba(17,24,39,0.22)]" role="status">{toast}</div>
	{/if}

	<section class="min-w-0 min-[901px]:col-start-2">
		{#if activeTab === 'add'}
			<div class="min-w-0">
				<div class="mb-3.5 flex flex-col gap-3 min-[561px]:flex-row min-[561px]:items-end min-[561px]:justify-between">
					<div>
						<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">Add</p>
						<h2 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">注文追加</h2>
					</div>
					<div class="flex flex-wrap items-center gap-2.5 min-[561px]:justify-end">
						<button class="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={() => runGacha()} disabled={busy || !clientState}>
							<span class="i-tabler-dice-3"></span>
							ガチャ
						</button>
						<label class="w-[min(360px,100%)]">
							<span class="mb-1.5 block text-xs font-bold text-slate-500">検索</span>
							<input class="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-950/10" bind:value={search} placeholder="メニューを検索" />
						</label>
					</div>
				</div>

				<div class="flex gap-2 overflow-x-auto pb-2.5" aria-label="カテゴリ">
					{#each categories as category}
						<button
							class={selectedCategory === category
								? 'min-h-9 flex-none rounded-full border border-slate-950 bg-slate-950 px-3 font-bold text-white'
								: 'min-h-9 flex-none rounded-full border border-slate-300 bg-white px-3 font-bold text-slate-700'}
							onclick={() => (selectedCategory = category)}
						>
							{category}
						</button>
					{/each}
				</div>

				<div class="my-3.5 flex gap-2.5">
					<input
						class="min-h-11 w-full max-w-36 rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-950/10"
						bind:value={manualCode}
						placeholder="4 桁番号"
						inputmode="numeric"
						maxlength="4"
						onkeydown={(event) => event.key === 'Enter' && addManualCode()}
					/>
					<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={addManualCode} disabled={busy || !clientState}>番号で追加</button>
				</div>
				<p class="mt-[-4px] mb-3.5 text-xs leading-normal text-slate-500">AIで生成された画像です。この画像は実際の商品と異なる可能性があります。</p>

				{#if filteredMenu.length}
					<div class="grid grid-cols-1 gap-3 min-[561px]:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
						{#each filteredMenu as item}
							{@const coverImage = menuCoverImages[item.code] ?? item.imageUrl}
							<button
								class="group relative block aspect-[4/3] min-h-44 w-full overflow-hidden rounded-lg border border-slate-900/10 bg-slate-200 p-0 text-left text-white transition hover:-translate-y-px hover:border-slate-900/30 hover:shadow-[0_10px_24px_rgba(17,24,39,0.08)] disabled:cursor-not-allowed disabled:opacity-55"
								onclick={() => addItem(item)}
								disabled={busy || !clientState}
							>
								{#if coverImage}
									<img class="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" src={coverImage} alt="" loading="lazy" />
								{:else}
									<div class="absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,rgba(22,101,52,0.86),rgba(30,64,175,0.72)),#166534] text-3xl font-black text-white/90" aria-hidden="true">
										<span>{item.category.slice(0, 2)}</span>
									</div>
								{/if}
								<div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,24,39,0)_34%,rgba(17,24,39,0.84)_100%)]"></div>
								<div class="absolute right-0 bottom-0 left-0 z-[1] p-3.5">
									<strong class="line-clamp-2 text-[15px] leading-snug font-extrabold [text-shadow:0_1px_8px_rgba(0,0,0,0.42)]">{item.name}</strong>
									<div class="mt-2.5 flex items-center justify-between gap-2">
										<span
											class={menuStatuses[item.code] === 'loading'
												? 'inline-grid min-h-6 place-items-center rounded-full bg-indigo-50/95 px-2.5 text-xs font-black whitespace-nowrap text-indigo-800'
												: menuStatuses[item.code] === 'available'
													? 'inline-grid min-h-6 place-items-center rounded-full bg-green-50/95 px-2.5 text-xs font-black whitespace-nowrap text-emerald-700'
													: menuStatuses[item.code] === 'unavailable'
														? 'inline-grid min-h-6 place-items-center rounded-full bg-red-50/95 px-2.5 text-xs font-black whitespace-nowrap text-red-800'
														: menuStatuses[item.code] === 'error'
															? 'inline-grid min-h-6 place-items-center rounded-full bg-orange-50/95 px-2.5 text-xs font-black whitespace-nowrap text-orange-800'
															: 'inline-grid min-h-6 place-items-center rounded-full bg-white/90 px-2.5 text-xs font-black whitespace-nowrap text-slate-700'}
										>
											{statusLabel(menuStatuses[item.code])}
										</span>
										<small class="text-xs font-black whitespace-nowrap text-white/90">¥{item.price.toLocaleString()}</small>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{:else}
					<div class="grid gap-1.5 rounded-lg border border-dashed border-slate-300 p-5 text-slate-500">
						<strong class="text-slate-950">表示できるメニューがありません</strong>
						<span>検索条件を変えるか、4 桁番号で追加してください。</span>
					</div>
				{/if}
			</div>
		{:else if activeTab === 'cart'}
			<div class="rounded-lg border border-slate-900/10 bg-white/90 p-4 min-[901px]:sticky min-[901px]:top-3.5">
				<div class="mb-3.5 flex items-end justify-between gap-4">
					<div>
						<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">Cart</p>
						<h2 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">注文かご</h2>
					</div>
					<strong class="text-xl">{totalCount} 点</strong>
				</div>

				{#if localCart.length}
					<div class="grid max-h-[360px] gap-2 overflow-auto pr-0.5">
						{#each localCart as item, index}
							<div class="grid grid-cols-[minmax(0,1fr)_104px_82px_36px] items-center gap-2.5 border-b border-slate-200 py-2.5 max-[560px]:grid-cols-[minmax(0,1fr)_96px_36px]">
								<div>
									<strong class="block">{item.name ?? item.id}</strong>
									<span class="block text-xs text-slate-500">{item.id}</span>
								</div>
								<div class="grid grid-cols-[30px_minmax(32px,1fr)_30px] items-center overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label={`${item.name ?? item.id} の数量`}>
									<button
										class="h-[34px] min-w-0 bg-transparent text-center font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400"
										aria-label="数量を減らす"
										onclick={() => updateItemCount(index, item, item.count - 1)}
										disabled={busy}
									>
										-
									</button>
									<input
										class="h-[34px] min-h-0 min-w-0 border-0 border-x border-slate-200 bg-transparent text-center font-extrabold text-slate-950 outline-none"
										aria-label="数量"
										value={item.count}
										inputmode="numeric"
										onchange={(event) =>
											updateItemCount(
												index,
												item,
												Number((event.currentTarget as HTMLInputElement).value)
											)}
									/>
									<button
										class="h-[34px] min-w-0 bg-transparent text-center font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:text-slate-400"
										aria-label="数量を増やす"
										onclick={() => updateItemCount(index, item, item.count + 1)}
										disabled={busy || item.count >= 99}
									>
										+
									</button>
								</div>
								<span class="block text-right font-extrabold max-[560px]:hidden">¥{((item.price ?? 0) * item.count).toLocaleString()}</span>
								<button
									class="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-red-800 disabled:cursor-not-allowed disabled:opacity-55"
									aria-label={`${item.name ?? item.id} を削除`}
									onclick={() => removeItem(index, item)}
									disabled={busy}
								>
									<span class="i-tabler-trash"></span>
								</button>
							</div>
						{/each}
					</div>
				{:else}
					<div class="grid gap-1.5 rounded-lg border border-dashed border-slate-300 p-5 text-slate-500">
						<strong class="text-slate-950">まだ空です</strong>
						<span>注文追加タブから 4 桁番号を入力して追加できます。</span>
					</div>
				{/if}

				<div class="mt-[18px] mb-3 flex items-center justify-between border-t border-slate-200 pt-4">
					<span>合計</span>
					<strong class="text-3xl">¥{totalPrice.toLocaleString()}</strong>
				</div>

				<div class="grid grid-cols-2 gap-2.5">
					<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" onclick={() => (activeTab = 'add')}>注文追加</button>
					<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55" onclick={submitOrder} disabled={!canOrder}>注文送信</button>
				</div>
			</div>
		{:else if activeTab === 'history'}
			<div class="min-w-0 rounded-lg border border-slate-900/10 bg-white/90 p-[18px]">
				<div class="mb-3 flex items-end justify-between gap-3">
					<div>
						<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">History</p>
						<h2 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">注文履歴</h2>
					</div>
					<strong class="text-[22px]">¥{accountTotal.toLocaleString()}</strong>
				</div>

				<div class="grid grid-cols-2 gap-2.5">
					<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={loadAccount} disabled={busy || !clientState}>履歴を更新</button>
				</div>

				{#if checkout && accountCount > 0}
					<div class="mt-3 grid max-h-[220px] gap-1.5 overflow-auto">
						{#each checkout.account.lines as line}
							<div class="grid grid-cols-[minmax(0,1fr)_32px_76px] items-center gap-2 border-b border-slate-100 py-2 text-[13px]">
								<span class="overflow-hidden text-ellipsis whitespace-nowrap text-left">{line.name}</span>
								<span class="text-right">{line.count}</span>
								<strong class="text-right">¥{line.price.toLocaleString()}</strong>
							</div>
						{/each}
					</div>
				{:else}
					<div class="mt-3 grid gap-1.5 rounded-lg border border-dashed border-slate-300 p-4 text-slate-500">
						<strong class="text-slate-950">注文履歴はまだありません</strong>
						<span>注文送信後にここへ反映されます。</span>
					</div>
				{/if}
			</div>
		{:else if activeTab === 'call'}
			<div class="grid min-h-80 justify-items-center gap-5 rounded-lg border border-slate-900/10 bg-white/90 p-[18px] text-center content-center">
				<div>
					<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">Call</p>
					<h2 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">店員呼び出し</h2>
				</div>
				<button class="inline-flex min-h-14 w-[min(100%,340px)] items-center justify-center gap-2.5 rounded-lg bg-slate-950 px-4 text-[17px] font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55" onclick={() => callStaff()} disabled={busy || !clientState}>
					<span class="i-tabler-bell text-[22px]"></span>
					店員を呼ぶ
				</button>
				<button class="inline-flex min-h-14 w-[min(100%,340px)] items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 text-[17px] font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={() => callStaff(true)} disabled={busy || !clientState}>
					<span class="i-tabler-ice-cream-2 text-[22px]"></span>
					デザートを持ってきてもらう
				</button>
			</div>
		{:else}
			<div class="min-w-0 rounded-lg border border-slate-900/10 bg-white/90 p-4">
				<div class="mb-3 flex items-end justify-between gap-3">
					<div>
						<p class="m-0 mb-2 text-xs font-extrabold uppercase text-green-700">Checkout</p>
						<h2 class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">会計</h2>
					</div>
					<strong class="text-[22px]">¥{accountTotal.toLocaleString()}</strong>
				</div>

				{#if checkout?.receiptShown}
					<div class="my-3 grid gap-3 rounded-lg border border-green-200 bg-green-50 p-[18px] text-center text-green-950" aria-live="polite">
						<div class="grid gap-1.5">
							<span class="text-[13px] font-extrabold">Table {clientState?.tableNo}</span>
							<strong class="[overflow-wrap:anywhere] text-[clamp(22px,6vw,40px)] tracking-normal">{checkout.barcodeValue}</strong>
						</div>
						{#if checkout.barcodeImageSrc}
							<img
								class="mx-auto my-1 block h-[92px] w-[min(100%,420px)] border-[12px] border-white bg-white object-fill shadow-[inset_0_0_0_1px_rgba(17,24,39,0.08)]"
								src={checkout.barcodeImageSrc}
								alt={`会計バーコード ${checkout.barcodeValue}`}
							/>
						{/if}
						<p class="m-0 font-extrabold">この画面をレジで提示してください。</p>
					</div>
				{:else}
					<div class="grid grid-cols-2 gap-2.5">
						<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950 disabled:cursor-not-allowed disabled:opacity-55" onclick={loadAccount} disabled={busy || !clientState}>
							明細を更新
						</button>
						<button
							class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55"
							onclick={settleCheckout}
							disabled={busy || !clientState || accountCount === 0}
						>
							お会計する
						</button>
					</div>
				{/if}

				{#if checkout && accountCount > 0}
					<div class="mt-3 grid max-h-80 gap-1.5 overflow-auto">
						{#each checkout.account.lines as line}
							<div class="grid grid-cols-[minmax(0,1fr)_32px_76px] items-center gap-2 border-b border-slate-100 py-2 text-[13px]">
								<span class="overflow-hidden text-ellipsis whitespace-nowrap text-left">{line.name}</span>
								<span class="text-right">{line.count}</span>
								<strong class="text-right">¥{line.price.toLocaleString()}</strong>
							</div>
						{/each}
					</div>
				{:else}
					<div class="mt-3 grid gap-1.5 rounded-lg border border-dashed border-slate-300 p-4 text-slate-500">
						<strong class="text-slate-950">会計できる注文がありません</strong>
						<span>注文を送信すると、ここで明細確認と会計確定ができます。</span>
					</div>
				{/if}

				<div class="mt-[18px] mb-0 flex items-center justify-between border-t border-slate-200 pt-4">
					<span>{accountCount} 点</span>
					<strong class="text-3xl">¥{accountTotal.toLocaleString()}</strong>
				</div>
			</div>
		{/if}
	</section>

	<nav
		class="fixed right-0 bottom-0 left-0 z-20 grid grid-cols-6 gap-1 border-t border-slate-900/10 bg-white/95 px-[max(8px,env(safe-area-inset-left))] pt-2 pb-[max(8px,env(safe-area-inset-bottom))] backdrop-blur-2xl min-[901px]:sticky min-[901px]:top-6 min-[901px]:right-auto min-[901px]:bottom-auto min-[901px]:left-auto min-[901px]:col-start-1 min-[901px]:row-start-1 min-[901px]:row-span-4 min-[901px]:flex min-[901px]:min-h-[calc(100svh-48px)] min-[901px]:flex-col min-[901px]:self-start min-[901px]:border-t-0 min-[901px]:border-r min-[901px]:bg-transparent min-[901px]:p-0 min-[901px]:pr-3.5 min-[901px]:backdrop-blur-none"
		aria-label="注文ナビゲーション"
	>
		{#each tabItems as tab}
			<button
				class={activeTab === tab.id
					? 'relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg bg-slate-950 p-1 text-center text-[11px] font-extrabold text-white min-[901px]:min-h-[46px] min-[901px]:w-full min-[901px]:flex-row min-[901px]:justify-start min-[901px]:gap-3 min-[901px]:rounded-full min-[901px]:px-4 min-[901px]:text-left min-[901px]:text-sm'
					: 'relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg p-1 text-center text-[11px] font-extrabold text-slate-700 transition hover:bg-slate-950 hover:text-white min-[901px]:min-h-[46px] min-[901px]:w-full min-[901px]:flex-row min-[901px]:justify-start min-[901px]:gap-3 min-[901px]:rounded-full min-[901px]:px-4 min-[901px]:text-left min-[901px]:text-sm'}
				onclick={() => (activeTab = tab.id)}
			>
				<span class={`${tab.icon} text-[22px]`} aria-hidden="true"></span>
				<span>{tab.label}</span>
				{#if tab.id === 'cart' && tab.count && tab.count > 0}
					<strong class="absolute top-1 right-[calc(50%-24px)] grid h-[22px] min-w-[22px] place-items-center rounded-full bg-red-600 px-1.5 text-xs leading-none text-white min-[901px]:static">{tab.count > 99 ? '99+' : tab.count}</strong>
				{/if}
			</button>
		{/each}
		<a class="relative flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg p-1 text-center text-[11px] font-extrabold text-slate-700 no-underline transition hover:bg-slate-950 hover:text-white min-[901px]:min-h-[46px] min-[901px]:w-full min-[901px]:flex-row min-[901px]:justify-start min-[901px]:gap-3 min-[901px]:rounded-full min-[901px]:px-4 min-[901px]:text-left min-[901px]:text-sm" href={`/sessions/${sessionId}/ai`}>
			<span class="i-tabler-sparkles text-[22px]" aria-hidden="true"></span>
			<span>zeriyaGPT</span>
		</a>
	</nav>
</main>

<AppDialog bind:open={gachaDialogOpen} eyebrow="Gacha" title={`${gachaBudget}円ガチャ結果`}>
	<form class="grid gap-3" onsubmit={(event) => event.preventDefault()}>
		<label class="flex items-center gap-2.5">
			<span class="text-xs font-bold text-slate-500">予算 (円)</span>
			<input class="min-h-11 w-[100px] rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-950/10" bind:value={gachaBudget} type="number" min="100" max="9999" step="100" />
		</label>
		<label class="inline-flex min-h-11 items-center gap-2 font-extrabold text-slate-950">
				<input
					class="m-0 h-[18px] min-h-0 w-[18px] accent-slate-950"
					type="checkbox"
					bind:checked={excludeAlcoholFromGacha}
					onchange={(event) => {
						const checked = (event.currentTarget as HTMLInputElement).checked;
						if (checked && gachaResults.some((selection) => isAlcoholMenuItem(selection.item))) {
							runGacha();
						}
					}}
				/>
			<span>お酒を抽選から除外</span>
		</label>
			{#if gachaHasRun}
				<p class="m-0 text-sm leading-relaxed text-slate-600">
					予算ちょうどの組み合わせは <strong>{gachaCount.toLocaleString()}</strong> 通りです。
				</p>
			{/if}
		{#if gachaResults.length}
			<div class="grid gap-1.5">
				{#each gachaResults as item}
					<div class="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-sm">
							<span>{item.item.name} × {item.quantity}</span>
							<strong>¥{item.subtotal.toLocaleString()}</strong>
					</div>
				{/each}
			</div>
			<div class="flex items-center justify-between gap-2 border-t border-slate-900/10 px-2.5 pt-2.5 font-bold">
				<span>合計</span>
					<strong>¥{gachaResults.reduce((sum, item) => sum + item.subtotal, 0).toLocaleString()}</strong>
			</div>
		{:else}
				<p class="m-0 py-3 text-center text-sm text-slate-500">予算ちょうどの組み合わせがありません。</p>
		{/if}
		<div class="grid grid-cols-3 gap-2.5">
			<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={() => (gachaDialogOpen = false)}>閉じる</button>
			<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={() => runGacha()}>もう一度</button>
			{#if gachaResults.length}
				<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" onclick={addGachaToCart} disabled={busy || !clientState}>
					カートに追加
				</button>
			{/if}
		</div>
	</form>
</AppDialog>
