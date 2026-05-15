<script lang="ts">
	import { goto } from '$app/navigation';
	import AppDialog from '$lib/components/AppDialog.svelte';
	import { onDestroy, onMount } from 'svelte';
	import QrScanner from 'qr-scanner';

	type ClientState = {
		baseURL?: string;
		nextId: string;
		shopId: number;
		tableNo: number;
		peopleCount: number;
		pageKind: string;
		cart: Array<{
			id: string;
			name?: string;
			price?: number;
			count: number;
		}>;
	};

	type OfficialSessionSnapshot = {
		id: string;
		state: ClientState & { baseURL: string };
		cookies: [string, string][];
		createdAt: number;
		updatedAt: number;
	};

	type PendingSession = {
		id: string;
		state: ClientState;
		officialSession: OfficialSessionSnapshot;
		url: string;
	};

	type CameraOption = {
		id: string;
		label: string;
	};

	let qrURL = $state('');
	let peopleCount = $state(2);
	let pendingSession = $state<PendingSession | null>(null);
	let error = $state('');
	let busy = $state(false);
	let scannerActive = $state(false);
	let scannerReady = $state(false);
	let confirmDialogOpen = $state(false);
	let peopleDialogOpen = $state(false);
	let manualDialogOpen = $state(false);
	let cameras = $state<CameraOption[]>([]);
	let selectedCameraId = $state('');
	let cameraBusy = $state(false);
	let video: HTMLVideoElement | null = null;
	let scanner: QrScanner | null = null;

	const officialSessionStorageKey = (id: string) => `betterzeriya:${id}:official-session`;

	const saveOfficialSession = (snapshot: OfficialSessionSnapshot) => {
		sessionStorage.setItem(officialSessionStorageKey(snapshot.id), JSON.stringify(snapshot));
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
			return payload as T;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : '通信に失敗しました';
			throw caught;
		} finally {
			busy = false;
		}
	}

	const openManualDialog = () => {
		error = '';
		manualDialogOpen = true;
	};

	const prepareSession = async (value: string) => {
		const nextURL = value.trim();
		if (!nextURL.toLowerCase().includes('saizeriya')) {
			return;
		}
		if (!URL.canParse(nextURL)) {
			error = '公式 QR の URL として読み取れませんでした。';
			return;
		}
		if (busy || pendingSession) {
			return;
		}

		qrURL = nextURL;
		try {
			const result = await requestJSON<{
				id: string;
				state: ClientState;
				officialSession: OfficialSessionSnapshot;
			}>('/api/sessions', {
				qrURLSource: nextURL
			});
			saveOfficialSession(result.officialSession);
			pendingSession = { ...result, url: nextURL };
			if (result.state.peopleCount > 0) {
				peopleCount = result.state.peopleCount;
			}
			await stopScanner();
			manualDialogOpen = false;
			confirmDialogOpen = true;
		} catch {}
	};

	const submitManualURL = async () => {
		if (!qrURL.trim()) {
			error = '公式 QR URL を入力してください。';
			return;
		}
		if (!qrURL.toLowerCase().includes('saizeriya')) {
			error = 'saizeriya を含む公式 QR URL を入力してください。';
			return;
		}
		await prepareSession(qrURL);
	};

	const confirmSession = async () => {
		if (!pendingSession) {
			return;
		}
		confirmDialogOpen = false;
		if (pendingSession.state.peopleCount > 0) {
			await selectPeopleCount(pendingSession.state.peopleCount);
			return;
		}
		peopleDialogOpen = true;
	};

	const openPeopleDialog = () => {
		confirmDialogOpen = false;
		peopleDialogOpen = true;
	};

	const selectPeopleCount = async (count: number) => {
		if (!pendingSession) {
			return;
		}

		try {
			const result = await requestJSON<{ state: ClientState; officialSession: OfficialSessionSnapshot }>(
				`/api/sessions/${pendingSession.id}/people`,
				{ peopleCount: count, officialSession: pendingSession.officialSession }
			);
			saveOfficialSession(result.officialSession);
			peopleCount = result.state.peopleCount;
			await goto(`/sessions/${pendingSession.id}`);
		} catch {}
	};

	const cancelSession = async () => {
		pendingSession = null;
		confirmDialogOpen = false;
		peopleDialogOpen = false;
		await startScanner();
	};

	const loadCameras = async () => {
		try {
			const nextCameras = await QrScanner.listCameras(true);
			cameras = nextCameras;
			if (!selectedCameraId && nextCameras.length > 0) {
				const environmentCamera =
					nextCameras.find((camera) => /back|rear|environment|外|背面/i.test(camera.label)) ??
					nextCameras.at(-1);
				selectedCameraId = environmentCamera?.id ?? nextCameras[0]?.id ?? '';
			}
		} catch {
			cameras = [];
		}
	};

	const switchCamera = async () => {
		if (!scanner || cameraBusy || cameras.length < 2) {
			return;
		}

		cameraBusy = true;
		error = '';
		try {
			const currentIndex = Math.max(
				0,
				cameras.findIndex((camera) => camera.id === selectedCameraId)
			);
			const nextCamera = cameras[(currentIndex + 1) % cameras.length];
			if (!nextCamera) {
				return;
			}
			await scanner.setCamera(nextCamera.id);
			selectedCameraId = nextCamera.id;
		} catch {
			error = 'カメラを切り替えられませんでした。';
		} finally {
			cameraBusy = false;
		}
	};

	const startScanner = async () => {
		error = '';
		if (scannerActive || busy || pendingSession) {
			return;
		}
		if (!video) {
			error = 'カメラを開始できませんでした。下部から URL を入力してください。';
			return;
		}

		try {
			if (!scanner) {
				scanner = new QrScanner(
					video,
					(result) => {
						const value = result.data;
						if (value.toLowerCase().includes('saizeriya')) {
							void prepareSession(value);
						}
					},
					{
						preferredCamera: selectedCameraId || 'environment',
						maxScansPerSecond: 8,
						returnDetailedScanResult: true
					}
				);
			}
			await scanner.start();
			scannerActive = true;
			scannerReady = true;
			await loadCameras();
		} catch {
			error = 'カメラを開始できませんでした。下部から URL を入力してください。';
			scannerActive = false;
			scannerReady = false;
		}
	};

	const stopScanner = async () => {
		scannerActive = false;
		scanner?.stop();
	};

	const destroyScanner = () => {
		scannerActive = false;
		scanner?.destroy();
		scanner = null;
	};

	const toggleFlash = async () => {
		try {
			await scanner?.toggleFlash();
		} catch {
			error = 'この端末ではライトを操作できません。';
		}
	};

	onMount(() => {
		void startScanner();
	});

	onDestroy(() => {
		destroyScanner();
	});
</script>

<svelte:head>
	<title>ご注文はこちら</title>
	<meta name="description" content="サイゼリヤ公式モバイルオーダー互換クライアント" />
</svelte:head>

<main class="relative min-h-svh overflow-hidden bg-slate-950 text-white">
	<video bind:this={video} class="absolute inset-0 h-full w-full object-cover" muted playsinline aria-label="QR リーダー"></video>

	<div
		class="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,transparent_0_10.5rem,rgba(3,7,18,0.28)_10.6rem),linear-gradient(180deg,rgba(3,7,18,0.82),rgba(3,7,18,0.1)_34%,rgba(3,7,18,0.12)_62%,rgba(3,7,18,0.86))]"
		aria-hidden="true"
	>
		<div class="relative aspect-[0.74] w-[min(80vw,360px)]">
			<span class="absolute top-0 left-0 h-[30px] w-[30px] rounded-tl-lg border-t-[3px] border-l-[3px] border-white"></span>
			<span class="absolute top-0 right-0 h-[30px] w-[30px] rounded-tr-lg border-t-[3px] border-r-[3px] border-white"></span>
			<span class="absolute bottom-0 left-0 h-[30px] w-[30px] rounded-bl-lg border-b-[3px] border-l-[3px] border-white"></span>
			<span class="absolute right-0 bottom-0 h-[30px] w-[30px] rounded-br-lg border-r-[3px] border-b-[3px] border-white"></span>
		</div>
	</div>

	<header
		class="absolute top-[max(8px,env(safe-area-inset-top))] right-[max(8px,env(safe-area-inset-right))] left-[max(8px,env(safe-area-inset-left))] z-10 grid grid-cols-[42px_minmax(0,1fr)_64px] items-center gap-2"
	>
		<button class="grid min-h-10 items-center justify-start p-0 text-2xl font-extrabold text-white disabled:opacity-35" aria-label="閉じる" onclick={stopScanner}>
			<span class="i-tabler-x"></span>
		</button>
		<strong class="text-center text-sm font-extrabold text-white">ご注文はこちら</strong>
		<button
			class="grid min-h-10 items-center justify-end p-0 text-2xl font-extrabold text-white disabled:opacity-35"
			aria-label="カメラ切り替え"
			onclick={switchCamera}
			disabled={cameraBusy || cameras.length < 2}
		>
			<span class="i-tabler-camera-rotate"></span>
		</button>
	</header>

	<div
		class="absolute top-[calc(max(8px,env(safe-area-inset-top))+46px)] right-4 left-4 z-10 mx-auto grid max-w-[520px] grid-cols-2 gap-1.5 rounded-lg border border-white/10 bg-white/10 p-1 backdrop-blur-2xl"
		role="tablist"
		aria-label="入力方法"
	>
		<button class="flex min-h-[34px] items-center justify-center gap-2 rounded-md bg-black/30 text-[13px] font-extrabold text-white" role="tab" aria-selected="true">
			<span class="i-tabler-qrcode text-lg"></span>
			QR 読み取り
		</button>
		<button class="flex min-h-[34px] items-center justify-center gap-2 rounded-md text-[13px] font-extrabold text-white/70" role="tab" aria-selected="false" onclick={openManualDialog}>
			<span class="i-tabler-link text-lg"></span>
			URL 入力
		</button>
	</div>

	{#if error}
		<div
			class="absolute right-[max(18px,env(safe-area-inset-right))] bottom-[calc(max(20px,env(safe-area-inset-bottom))+60px)] left-[max(18px,env(safe-area-inset-left))] z-10 rounded-lg bg-red-800/95 px-3.5 py-3 font-extrabold text-white"
			role="alert"
		>
			{error}
		</div>
	{/if}

	<div
		class="absolute right-[max(18px,env(safe-area-inset-right))] bottom-[max(20px,env(safe-area-inset-bottom))] left-[max(18px,env(safe-area-inset-left))] z-10 grid justify-items-center gap-4"
	>
		<div class="grid gap-1.5 text-center text-white [text-shadow:0_1px_18px_rgba(0,0,0,0.7)]">
			<button class="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/25 bg-white/10 text-2xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl" aria-label="ライト" onclick={toggleFlash}>
				<span class="i-tabler-flashlight"></span>
			</button>
			<span class="text-[13px] font-extrabold">{busy ? 'テーブルを確認しています' : scannerActive ? 'テーブルにある QR コードを読み取ってください' : scannerReady ? '停止中です' : 'カメラを起動しています'}</span>
			{#if cameras.length > 1}
				<small class="max-w-[min(78vw,360px)] overflow-hidden text-xs font-extrabold text-ellipsis whitespace-nowrap text-white/70">{cameras.find((camera) => camera.id === selectedCameraId)?.label ?? 'カメラ選択中'}</small>
			{/if}
		</div>
		<button class="flex min-h-[38px] items-center gap-2 rounded-full border border-white/20 bg-slate-950/40 px-3.5 text-[13px] font-extrabold text-white no-underline backdrop-blur-xl" onclick={openManualDialog}>
			<span class="i-tabler-help-circle text-lg"></span>
			読み取れない場合
		</button>
	</div>
</main>

<AppDialog bind:open={confirmDialogOpen} eyebrow="Confirm" title={pendingSession ? `${pendingSession.state.tableNo} テーブル${pendingSession.state.peopleCount > 0 ? ` / ${pendingSession.state.peopleCount} 名様` : ''}で間違いないですか？` : ''}>
	{#if pendingSession}
		<div class="grid gap-3">
			<div class="flex flex-wrap gap-2">
				<span class="rounded-full bg-green-50 px-2.5 py-1.5 text-xs font-extrabold text-green-800">Shop {pendingSession.state.shopId}</span>
				{#if pendingSession.state.peopleCount > 0}
					<span class="rounded-full bg-green-50 px-2.5 py-1.5 text-xs font-extrabold text-green-800">{pendingSession.state.peopleCount} 名様</span>
				{/if}
			</div>
			<div class={pendingSession.state.peopleCount > 0 ? 'grid grid-cols-3 gap-2.5' : 'grid grid-cols-2 gap-2.5'}>
				<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={cancelSession}>読み直す</button>
				{#if pendingSession.state.peopleCount > 0}
					<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={openPeopleDialog}>人数変更</button>
					<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white" type="button" onclick={confirmSession}>注文へ進む</button>
				{:else}
					<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white" type="button" onclick={confirmSession}>次へ</button>
				{/if}
			</div>
		</div>
	{/if}
</AppDialog>

<AppDialog bind:open={peopleDialogOpen} eyebrow="People" title="何名様でご利用ですか？">
	{#if pendingSession}
		<div class="grid gap-3">
			<div class="grid grid-cols-4 gap-2">
				{#each [1, 2, 3, 4, 5, 6, 7, 8] as count}
					<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-2 font-extrabold text-slate-950" type="button" onclick={() => selectPeopleCount(count)}>
						{count} 人
					</button>
				{/each}
			</div>
			<label>
				<span class="mb-1.5 block text-xs font-bold text-slate-500">9 人以上</span>
				<input class="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-950/10" bind:value={peopleCount} type="number" min="1" max="99" />
			</label>
			<div class="grid grid-cols-2 gap-2.5">
				<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={() => (peopleDialogOpen = false)}>戻る</button>
				<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" onclick={() => selectPeopleCount(peopleCount)} disabled={busy}>
					確定
				</button>
			</div>
		</div>
	{/if}
</AppDialog>

<AppDialog bind:open={manualDialogOpen} eyebrow="Manual" title="QR URL を入力">
	<form class="grid gap-3" onsubmit={(event) => event.preventDefault()}>
		<label>
			<span class="mb-1.5 block text-xs font-bold text-slate-500">公式 QR URL</span>
			<input class="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-slate-950 outline-none focus:border-slate-950 focus:ring-4 focus:ring-slate-950/10" bind:value={qrURL} placeholder="https://ioes.saizeriya.co.jp/..." inputmode="url" />
		</label>
		<div class="grid grid-cols-2 gap-2.5">
			<button class="min-h-11 rounded-lg border border-slate-300 bg-white px-4 font-extrabold text-slate-950" type="button" onclick={() => (manualDialogOpen = false)}>閉じる</button>
			<button class="min-h-11 rounded-lg bg-slate-950 px-4 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-55" type="button" onclick={submitManualURL} disabled={busy}>接続</button>
		</div>
	</form>
</AppDialog>
