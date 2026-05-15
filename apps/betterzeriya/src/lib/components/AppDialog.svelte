<script lang="ts">
	import { Dialog } from '@ark-ui/svelte/dialog';
	import { Portal } from '@ark-ui/svelte/portal';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		eyebrow,
		title,
		children
	}: {
		open: boolean;
		eyebrow: string;
		title: string;
		children?: Snippet;
	} = $props();
</script>

<Dialog.Root bind:open lazyMount unmountOnExit>
	<Portal>
		<Dialog.Backdrop
			class="fixed inset-0 z-40 bg-slate-950/65 opacity-100 backdrop-blur-sm transition-opacity duration-200 data-[state=closed]:opacity-0"
		/>
		<Dialog.Positioner class="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
			<Dialog.Content
				class="grid max-h-[min(90svh,620px)] w-[min(420px,100%)] gap-3 overflow-auto rounded-lg border border-slate-900/10 bg-white p-5 text-slate-950 shadow-[0_28px_90px_rgba(0,0,0,0.28)] transition duration-200 data-[state=closed]:translate-y-2 data-[state=closed]:scale-[0.98] data-[state=closed]:opacity-0 data-[state=open]:translate-y-0 data-[state=open]:scale-100 data-[state=open]:opacity-100"
			>
				<p class="m-0 text-xs font-extrabold uppercase text-green-700">{eyebrow}</p>
				<Dialog.Title class="m-0 text-[22px] leading-tight font-extrabold tracking-normal">
					{title}
				</Dialog.Title>
				{@render children?.()}
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog.Root>
