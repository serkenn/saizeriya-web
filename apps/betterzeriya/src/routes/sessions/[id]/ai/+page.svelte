<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { buildSystemPrompt } from '$lib/zeriya-gpt/system-prompt';

	type ChatRole = 'user' | 'assistant';
	type ChatMessage = { role: ChatRole; content: string };

	type ModelOption = {
		id: string;
		label: string;
		hint: string;
	};

	const modelOptions: ModelOption[] = [
		{
			id: 'Qwen3-0.6B-q4f16_1-MLC',
			label: 'Qwen3 0.6B',
			hint: '初回 ~400MB · 最軽量'
		},
		{
			id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
			label: 'Llama 3.2 1B',
			hint: '初回 ~750MB · 軽量・サクサク'
		},
		{
			id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
			label: 'Llama 3.2 3B',
			hint: '初回 ~1.7GB · より賢い'
		},
		{
			id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
			label: 'Qwen2.5 1.5B',
			hint: '初回 ~950MB · 日本語そこそこ'
		}
	];

	const samplePrompts = [
		'1000円以内でお腹いっぱいになる組み合わせは?',
		'2人で3000円。ワインに合うおすすめ教えて',
		'子どもが喜ぶサイドメニューは?',
		'カロリー控えめで満足できる注文を考えて'
	];

	let { data } = $props<{ data: { sessionId: string } }>();

	const sessionHref = $derived(`/sessions/${data.sessionId}`);

	let selectedModel = $state(modelOptions[0].id);
	let webgpuSupported = $state(true);
	let engine = $state<unknown>(null);
	let engineLoading = $state(false);
	let loadProgress = $state(0);
	let loadText = $state('');
	let messages = $state<ChatMessage[]>([]);
	let input = $state('');
	let generating = $state(false);
	let error = $state('');
	let listEl: HTMLDivElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);

	const getWebGPU = () =>
		typeof navigator === 'undefined' ? null : ((navigator as Navigator & { gpu?: GPU }).gpu ?? null);

	const installWebGPUAdapterFallback = () => {
		const gpu = getWebGPU() as (GPU & { __betterzeriyaAdapterFallback?: true }) | null;
		if (!gpu || gpu.__betterzeriyaAdapterFallback) return;

		const requestAdapter = gpu.requestAdapter.bind(gpu);
		try {
			Object.defineProperty(gpu, 'requestAdapter', {
				configurable: true,
				value: async (options?: GPURequestAdapterOptions) => {
					const adapter = await requestAdapter(options);
					if (adapter || !options?.powerPreference) {
						return adapter;
					}
					return (
						(await requestAdapter()) ??
						(await requestAdapter({
							powerPreference:
								options.powerPreference === 'high-performance' ? 'low-power' : 'high-performance'
						}))
					);
				}
			});
			gpu.__betterzeriyaAdapterFallback = true;
		} catch {}
	};

	const isCloseToBottom = () => {
		if (!listEl) return true;
		return listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 80;
	};

	const scrollToBottom = async () => {
		await tick();
		if (listEl) listEl.scrollTop = listEl.scrollHeight;
	};

	const detectWebGPU = () => {
		return Boolean(getWebGPU());
	};

	const verifyWebGPUAdapter = async () => {
		const gpu = getWebGPU();
		if (!gpu) return false;
		const adapter =
			(await gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
			(await gpu.requestAdapter()) ??
			(await gpu.requestAdapter({ powerPreference: 'low-power' }));
		return Boolean(adapter);
	};

	const loadEngine = async () => {
		if (engineLoading) return;
		error = '';
		engineLoading = true;
		loadProgress = 0;
		loadText = 'モデルを準備しています…';
		try {
			installWebGPUAdapterFallback();
			const { CreateMLCEngine, prebuiltAppConfig } = await import('@mlc-ai/web-llm');
			const next = await CreateMLCEngine(selectedModel, {
				initProgressCallback: (report: { progress: number; text: string }) => {
					loadProgress = Math.max(0, Math.min(1, report.progress ?? 0));
					loadText = report.text || loadText;
				},
				appConfig: {
					...prebuiltAppConfig,
					cacheBackend: 'indexeddb'
				}
			});
			engine = next;
			loadText = '準備完了';
		} catch (caught) {
			engine = null;
			const message = caught instanceof Error ? caught.message : 'モデル読み込みに失敗しました';
			error = message.includes('Unable to find a compatible GPU')
				? 'WebGPU adapter を取得できませんでした。ブラウザのハードウェアアクセラレーション、GPUドライバ、chrome://gpu の WebGPU 状態を確認してください。'
				: message;
		} finally {
			engineLoading = false;
		}
	};

	const ensureEngine = async () => {
		if (!engine && !engineLoading) {
			await loadEngine();
		}
	};

	const handleSend = async () => {
		const trimmed = input.trim();
		if (!trimmed || generating || engineLoading) return;
		if (!webgpuSupported) {
			error = 'このブラウザは WebGPU に対応していません。';
			return;
		}
		await ensureEngine();
		if (!engine) return;

		input = '';
		messages = [...messages, { role: 'user', content: trimmed }];
		messages = [...messages, { role: 'assistant', content: '' }];
		generating = true;
		error = '';
		await scrollToBottom();

		try {
			const requestMessages = [
				{ role: 'system', content: buildSystemPrompt() },
				...messages
					.slice(0, -1)
					.map((m) => ({ role: m.role, content: m.content }))
			];

			const stream = await (engine as {
				chat: { completions: { create: (args: unknown) => Promise<AsyncIterable<unknown>> } };
			}).chat.completions.create({
				messages: requestMessages,
				stream: true,
				temperature: 0.7,
				max_tokens: 800
			});

			for await (const rawChunk of stream) {
				const chunk = rawChunk as {
					choices?: { delta?: { content?: string } }[];
				};
				const delta = chunk.choices?.[0]?.delta?.content ?? '';
				if (!delta) continue;
				const stickToBottom = isCloseToBottom();
				const last = messages[messages.length - 1];
				messages = [
					...messages.slice(0, -1),
					{ role: last.role, content: last.content + delta }
				];
				if (stickToBottom) await scrollToBottom();
			}
		} catch (caught) {
			error = caught instanceof Error ? caught.message : '応答中にエラーが発生しました';
		} finally {
			generating = false;
		}
	};

	const handleInterrupt = async () => {
		if (!engine || !generating) return;
		try {
			await (engine as { interruptGenerate: () => Promise<void> }).interruptGenerate();
		} catch {}
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			void handleSend();
		}
	};

	const autoGrow = () => {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 220)}px`;
	};

	const fillSample = (prompt: string) => {
		input = prompt;
		autoGrow();
		textareaEl?.focus();
	};

	const resetChat = () => {
		if (generating) return;
		messages = [];
		error = '';
	};

	const switchModel = async (id: string) => {
		if (generating || engineLoading || id === selectedModel) return;
		selectedModel = id;
		engine = null;
		await loadEngine();
	};

	onMount(() => {
		webgpuSupported = detectWebGPU();
		if (!webgpuSupported) {
			error = 'このブラウザは WebGPU に未対応です。Chrome / Edge デスクトップ版でお試しください。';
			return;
		}
		installWebGPUAdapterFallback();
		void verifyWebGPUAdapter().then((supported) => {
			webgpuSupported = supported;
			if (!supported) {
				error =
					'WebGPU adapter を取得できませんでした。ブラウザのハードウェアアクセラレーション、GPUドライバ、chrome://gpu の WebGPU 状態を確認してください。';
			}
		});
	});
</script>

<svelte:head>
	<title>zeriyaGPT</title>
	<meta name="description" content="ブラウザ内で動くサイゼリヤ提案 AI (WebGPU)" />
</svelte:head>

<div class="mx-auto grid min-h-svh max-w-[860px] grid-rows-[auto_auto_auto_auto_minmax(0,1fr)_auto] bg-slate-50 px-4">
	<header class="sticky top-0 z-10 grid grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-3 border-b border-slate-900/5 bg-slate-50/95 py-3.5 backdrop-blur-xl">
		<a href={sessionHref} class="grid h-10 w-10 place-items-center rounded-full border border-slate-900/10 bg-white text-xl text-slate-950 no-underline" aria-label="戻る">
			<span class="i-tabler-arrow-left"></span>
		</a>
		<div class="grid justify-items-center gap-0.5 text-center">
			<strong class="text-base font-extrabold text-slate-950">zeriyaGPT</strong>
			<small class="text-xs font-bold text-slate-500">WebGPU で動くブラウザ完結型アシスタント</small>
		</div>
		<button
			class="grid h-10 w-10 place-items-center rounded-full border border-slate-900/10 bg-white text-xl text-slate-950 disabled:opacity-40"
			type="button"
			onclick={resetChat}
			disabled={generating || messages.length === 0}
			aria-label="会話をリセット"
		>
			<span class="i-tabler-refresh"></span>
		</button>
	</header>

	<div class="flex gap-2 overflow-x-auto pt-3 pb-1">
		{#each modelOptions as opt (opt.id)}
			<button
				class={opt.id === selectedModel
					? 'grid flex-none gap-0.5 rounded-full border border-green-800 bg-green-50 px-3.5 py-2 text-left font-bold text-green-800 disabled:cursor-not-allowed disabled:opacity-50'
					: 'grid flex-none gap-0.5 rounded-full border border-slate-900/10 bg-white px-3.5 py-2 text-left font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50'}
				type="button"
				onclick={() => switchModel(opt.id)}
				disabled={generating || engineLoading}
			>
				<strong class="text-[13px]">{opt.label}</strong>
				<small class={opt.id === selectedModel ? 'text-xs font-bold text-green-800' : 'text-xs font-bold text-slate-500'}>{opt.hint}</small>
			</button>
		{/each}
	</div>

	{#if engineLoading}
		<div class="my-2 grid gap-1.5 rounded-xl border border-green-800/20 bg-green-50 px-3.5 py-3 font-bold text-green-800" role="status">
			<div class="h-1.5 overflow-hidden rounded-full bg-green-800/15">
				<div class="h-full bg-green-600 transition-[width] duration-200" style="width: {Math.round(loadProgress * 100)}%"></div>
			</div>
			<small class="text-xs text-green-800">{loadText}</small>
		</div>
	{/if}

	{#if error}
		<div class="my-2 rounded-xl bg-red-50 px-3.5 py-3 font-bold text-red-800" role="alert">{error}</div>
	{/if}

	<div class="grid content-start gap-4 overflow-y-auto px-1 py-5" bind:this={listEl}>
		{#if messages.length === 0}
			<div class="grid justify-items-center gap-2.5 px-2 pt-10 text-center text-slate-700">
				<div class="grid h-14 w-14 place-items-center rounded-[18px] bg-gradient-to-br from-green-600 to-green-800 text-3xl font-black text-white">Z</div>
				<h1 class="m-0 mt-1.5 text-[22px] font-extrabold text-slate-950">今日はどんなサイゼ？</h1>
				<p class="m-0 text-sm text-slate-500">予算・気分・人数を伝えてくれれば、メニューから提案します。</p>
				<div class="mt-3.5 grid w-full max-w-[540px] grid-cols-1 gap-2 min-[541px]:grid-cols-2">
					{#each samplePrompts as prompt (prompt)}
						<button class="rounded-xl border border-slate-900/10 bg-white px-3.5 py-3 text-left text-[13px] leading-normal font-bold text-slate-950 hover:border-green-800/40 hover:bg-green-50" type="button" onclick={() => fillSample(prompt)}>{prompt}</button>
					{/each}
				</div>
				<p class="mt-3.5 text-xs text-slate-400">
					※ モデルは初回のみダウンロード(~750MB〜)。以降はブラウザにキャッシュされます。
				</p>
			</div>
		{:else}
			{#each messages as message, index (index)}
				<div class={message.role === 'user' ? 'grid grid-cols-[minmax(0,1fr)_32px] gap-3' : 'grid grid-cols-[32px_minmax(0,1fr)] gap-3'}>
					<div class={message.role === 'user' ? 'col-start-2 row-start-1 grid h-8 w-8 place-items-center rounded-full bg-slate-950 text-xs font-black text-white' : 'grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-green-600 to-green-800 text-xs font-black text-white'} aria-hidden="true">
						{message.role === 'user' ? 'You' : 'Z'}
					</div>
					<div class={message.role === 'user' ? 'col-start-1 row-start-1 max-w-[84%] justify-self-end rounded-2xl bg-slate-950 px-3.5 py-3 text-white' : 'max-w-[84%] rounded-2xl border border-slate-900/5 bg-white px-3.5 py-3 leading-relaxed text-slate-950 shadow-sm'}>
						{#if message.content}
							<p class="m-0 whitespace-pre-wrap break-words text-[14.5px]">{message.content}</p>
						{:else}
							<span class="inline-flex gap-1">
								<i class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"></i>
								<i class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0.15s]"></i>
								<i class="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:0.3s]"></i>
							</span>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<div class="sticky bottom-0 bg-[linear-gradient(180deg,rgba(248,250,252,0)_0%,#f8fafc_24%)] pt-2.5 pb-[max(14px,env(safe-area-inset-bottom))]">
		<div class="grid grid-cols-[minmax(0,1fr)_44px] items-end gap-2 rounded-[22px] border border-slate-900/10 bg-white p-2 shadow-[0_14px_40px_rgba(17,24,39,0.08)]">
			<textarea
				class="max-h-[220px] min-h-8 w-full resize-none border-0 bg-transparent px-2.5 py-2 text-[15px] leading-normal text-slate-950 outline-none disabled:text-slate-400"
				bind:this={textareaEl}
				bind:value={input}
				oninput={autoGrow}
				onkeydown={handleKeydown}
				placeholder={engineLoading
					? 'モデルを準備中…'
					: webgpuSupported
						? 'メッセージを入力 (Enter で送信)'
						: 'WebGPU 対応ブラウザでアクセスしてください'}
				disabled={!webgpuSupported}
				rows="1"
			></textarea>
			{#if generating}
				<button class="grid h-11 w-11 place-items-center rounded-full bg-red-700 text-xl text-white" type="button" onclick={handleInterrupt} aria-label="停止">
					<span class="i-tabler-player-stop-filled"></span>
				</button>
			{:else}
				<button
					class="grid h-11 w-11 place-items-center rounded-full bg-slate-950 text-xl text-white disabled:bg-slate-300"
					type="button"
					onclick={handleSend}
					disabled={!input.trim() || engineLoading || !webgpuSupported}
					aria-label="送信"
				>
					<span class="i-tabler-arrow-up"></span>
				</button>
			{/if}
		</div>
		<small class="mt-2 block text-center text-xs font-bold text-slate-400">
			ブラウザ内で完結 · 入力内容はサーバーに送信されません
		</small>
	</div>
</div>
