export const DETECTOR_COVERAGE_MATRIX_SCHEMA_VERSION = 'runtime-detector-coverage-matrix/v1';

export function createDetectorCoverageMatrix({ adapter, performanceCapsule, flowCapsule }) {
  const flowKinds = new Set(flowCapsule?.coverage?.captured_kinds ?? []);
  const profile = performanceCapsule?.capture ?? {};
  const functions = performanceCapsule?.observed?.function_coverage?.functions ?? [];
  const goBenchmarks = performanceCapsule?.observed?.go_benchmarks ?? [];
  const peakRss = performanceCapsule?.observed?.peak_rss_bytes;
  const heapProfiles = performanceCapsule?.observed?.heap_profile_runs ?? [];
  const heapRepeatability = performanceCapsule?.observed?.heap_profile_repeatability;
  const lanes = [];

  if (['node-test', 'node-script', 'vitest', 'jest'].includes(adapter)) {
    lanes.push({
      lane: 'node',
      mechanisms: [
        mechanism('cpu_profile', profile.profile_files > 0, 'V8 CPU profile'),
        mechanism(
          'peak_process_memory',
          peakRss?.count > 0,
          'separate local process-tree RSS passes'
        ),
        mechanism(
          'heap_allocation_profile',
          heapProfiles.some((run) => run.profile_files > 0),
          'separate V8 sampling heap profiles'
        ),
        heapRepeatability?.qualified
          ? mechanism(
              'heap_allocation_source',
              true,
              'two material repository-owned V8 allocation profiles'
            )
          : unavailable(
              'heap_allocation_source',
              'Independent heap profiles did not repeat a material application allocation source.'
            ),
        unavailable(
          'memory_leak',
          'A sampling allocation profile does not provide exact forced-GC retained bytes or prove a leak.'
        ),
        mechanism('function_frequency', functions.length > 0, 'V8 function coverage'),
        mechanism('http_flow', flowKinds.has('http_server'), 'diagnostic Node HTTP preload'),
        mechanism('database_flow', flowKinds.has('database'), 'request-scoped node:sqlite preload'),
      ],
    });
  }
  if (['vitest', 'jest'].includes(adapter)) {
    lanes.push({
      lane: 'react',
      mechanisms: [
        mechanism('unit_runtime', true, `exact ${adapter === 'jest' ? 'Jest' : 'Vitest'} scope`),
        unavailable(
          'browser_navigation',
          'The unit-test runtime does not execute a browser navigation.'
        ),
        unavailable('browser_network', 'No bounded Playwright trace was supplied.'),
        unavailable('browser_render', 'No browser rendering evidence was supplied.'),
      ],
    });
  }
  if (adapter === 'playwright-trace') {
    const mainThread = flowCapsule?.browser_main_thread;
    const browserMemory = flowCapsule?.browser_memory;
    const repeatedMemory = flowCapsule?.browser_repeated_memory;
    const samePageMemory = flowCapsule?.browser_same_page_memory;
    const react = flowCapsule?.browser_react;
    const loading = flowCapsule?.browser_loading;
    const actions = flowCapsule?.browser_actions;
    const server = flowCapsule?.browser_server;
    const phases = mainThread?.phases ?? {};
    lanes.push({
      lane: 'react',
      mechanisms: [
        mechanism('browser_navigation', flowKinds.has('navigation'), 'bounded Playwright trace'),
        actions?.inventory?.observed_completed_action_count > 0
          ? mechanism('browser_action_timeline', true, 'bounded Playwright framework action events')
          : actions?.inventory?.started_action_count > 0
            ? insufficient(
                'browser_action_timeline',
                'bounded Playwright framework action events',
                'Safe action starts were observed without a bounded completed action.'
              )
            : unavailable(
                'browser_action_timeline',
                'The exact browser flow retained no safe Playwright action event.'
              ),
        mechanism('browser_network', flowKinds.has('http_client'), 'bounded Playwright trace'),
        server?.state === 'observed'
          ? mechanism('browser_server_request', true, 'capture-scoped owned Node request events')
          : unavailable(
              'browser_server_request',
              'No capture-scoped owned Node request evidence was retained.'
            ),
        server?.requests?.some((request) => request.cpu?.state === 'observed')
          ? mechanism(
              'browser_server_cpu',
              true,
              'isolated request-scoped V8 samples with contained repository sources'
            )
          : server?.requests?.some((request) => request.cpu !== null)
            ? insufficient(
                'browser_server_cpu',
                'bounded request-scoped V8 profiles',
                'Profiles were contaminated or did not cross fixed repository sample thresholds.'
              )
            : unavailable(
                'browser_server_cpu',
                'No bounded request-scoped V8 profile was retained.'
              ),
        server?.requests?.some((request) => request.async_resources?.length > 0)
          ? mechanism(
              'browser_server_async',
              true,
              'request-context first-callback delay for closed async resource categories'
            )
          : unavailable(
              'browser_server_async',
              'No supported request-context async callback delay was retained.'
            ),
        server?.requests?.some((request) =>
          request.children.some((child) => child.kind === 'database')
        )
          ? mechanism(
              'browser_server_database',
              true,
              'request-scoped built-in Node SQLite operations'
            )
          : unavailable(
              'browser_server_database',
              'No supported request-scoped database operation was retained.'
            ),
        server?.requests?.some((request) =>
          request.children.some((child) => child.kind === 'http_client')
        )
          ? mechanism(
              'browser_server_outbound',
              true,
              'request-scoped loopback Node fetch operations'
            )
          : unavailable(
              'browser_server_outbound',
              'No supported request-scoped outbound operation was retained.'
            ),
        loading?.inventory?.resources_with_transfer_size > 0
          ? mechanism(
              'browser_loading_sizes',
              true,
              'bounded Playwright HAR transfer-size snapshots'
            )
          : unavailable(
              'browser_loading_sizes',
              'The exact browser flow retained no valid resource transfer sizes.'
            ),
        loading?.inventory?.complete
          ? mechanism(
              'browser_loading_total',
              true,
              'complete exact-flow Playwright HAR resource inventory'
            )
          : loading?.state === 'observed'
            ? insufficient(
                'browser_loading_total',
                'bounded Playwright HAR resource inventory',
                'The resource inventory or transfer-size coverage was partial, so observed bytes are not a complete total.'
              )
            : unavailable(
                'browser_loading_total',
                'The exact browser flow retained no resource inventory.'
              ),
        loading?.completed_responses?.complete
          ? mechanism(
              'browser_completed_response_transfer',
              true,
              'complete transfer-size coverage for completed Playwright HAR responses'
            )
          : loading?.state === 'observed'
            ? insufficient(
                'browser_completed_response_transfer',
                'bounded Playwright HAR completed responses',
                'At least one completed response lacked a transfer size or the resource inventory was sampled.'
              )
            : unavailable(
                'browser_completed_response_transfer',
                'The exact browser flow retained no completed response inventory.'
              ),
        flowKinds.has('render_observation')
          ? insufficient(
              'browser_render',
              'bounded Playwright frame snapshots',
              'Frame state is observed, but the trace does not assign rendering duration.'
            )
          : unavailable('browser_render', 'The trace contained no bounded frame snapshot.'),
        mainThread?.renderer_main_thread_count > 0
          ? mechanism(
              'browser_main_thread',
              true,
              'bounded Chromium renderer-main-thread trace events'
            )
          : unavailable(
              'browser_main_thread',
              'No bounded Chromium renderer main thread was captured.'
            ),
        mainThread?.profile?.sample_count > 0
          ? mechanism('browser_javascript_cpu', true, 'bounded Chromium V8 CPU profile chunks')
          : unavailable('browser_javascript_cpu', 'No bounded Chromium V8 samples were captured.'),
        react?.state === 'succeeded'
          ? react.attribution === 'component_activity_observed'
            ? mechanism(
                'react_commit_activity',
                true,
                'separate exact-flow React DevTools hook diagnostic pass'
              )
            : insufficient(
                'react_commit_activity',
                'separate exact-flow React DevTools hook diagnostic pass',
                'React commits were observed without positive component profiling duration.'
              )
          : unavailable(
              'react_commit_activity',
              react?.state === 'not_detected'
                ? 'The declared React flow emitted no observable commit.'
                : 'No usable separate React commit diagnostic evidence was retained.'
            ),
        react?.state === 'succeeded' &&
        react.schema_version === 'runtime-playwright-react-commits/v2' &&
        react.measurement_complete === true &&
        react.profiled_commit_count >= 3 &&
        react.source_attribution?.state === 'complete'
          ? mechanism(
              'react_component_hotspot_diagnosis',
              true,
              'complete derived React self duration and unique bounded source attribution'
            )
          : react?.state === 'succeeded'
            ? insufficient(
                'react_component_hotspot_diagnosis',
                'derived React self duration plus bounded source attribution',
                'React evidence was legacy, incomplete, below the profiled-commit floor, or lacked a complete source scan.'
              )
            : unavailable(
                'react_component_hotspot_diagnosis',
                'No usable separate React component evidence was retained.'
              ),
        originalSourceMechanism(mainThread?.profile?.source_map),
        phaseMechanism('browser_style', phases.style, 'Chromium style trace events'),
        phaseMechanism('browser_layout', phases.layout, 'Chromium layout trace events'),
        phaseMechanism('browser_paint', phases.paint, 'Chromium paint trace events'),
        browserMemory?.peak_process_tree_rss_bytes > 0
          ? mechanism('browser_memory', true, 'peak local Playwright and Chromium process-tree RSS')
          : unavailable(
              'browser_memory',
              'The exact browser flow did not retain process-tree memory evidence.'
            ),
        mainThread?.memory_counters?.sample_count > 0
          ? mechanism(
              'browser_renderer_heap',
              true,
              'bounded Chromium UpdateCounters series without forced garbage collection'
            )
          : unavailable(
              'browser_renderer_heap',
              'The trace retained no bounded same-renderer heap counter series.'
            ),
        mainThread?.memory_counters?.sample_count > 0
          ? mechanism(
              'browser_dom_counters',
              true,
              'bounded Chromium DOM-node, document, and listener counters'
            )
          : unavailable(
              'browser_dom_counters',
              'The trace retained no bounded DOM counter series.'
            ),
        unavailable(
          'browser_memory_leak',
          samePageMemory?.retained_attribution?.candidate
            ? 'A sampled-live repository source repeated after forced GC, but sampling, three cycles, and missing dominator paths cannot prove a leak.'
            : samePageMemory?.state === 'succeeded'
              ? 'The complete same-page sequence did not produce a material sampled-live application retention candidate.'
              : 'No complete same-page forced-GC sequence can support retained-object analysis.'
        ),
        repeatedMemory?.state === 'succeeded'
          ? mechanism(
              'browser_repeated_memory',
              true,
              'three exact-flow fresh-context CDP samples before and after forced GC'
            )
          : unavailable(
              'browser_repeated_memory',
              'No complete three-repeat forced-GC memory distribution was retained.'
            ),
        samePageMemory?.state === 'succeeded'
          ? mechanism(
              'browser_same_page_memory',
              true,
              'three exact-flow callback cycles in one page and context with forced-GC samples'
            )
          : unavailable(
              'browser_same_page_memory',
              'No complete three-cycle same-page forced-GC sequence was retained.'
            ),
        samePageMemory?.retained_attribution?.candidate
          ? mechanism(
              'browser_retained_allocation_source',
              true,
              'three cumulative V8 sampled-live profiles after forced GC'
            )
          : samePageMemory?.retained_attribution?.state === 'succeeded'
            ? insufficient(
                'browser_retained_allocation_source',
                'three cumulative V8 sampled-live profiles after forced GC',
                'No material monotonically growing repository application source crossed policy.'
              )
            : unavailable(
                'browser_retained_allocation_source',
                'Sampled-live repository source attribution was unavailable.'
              ),
      ],
    });
  }
  if (['go-bench', 'go-trace'].includes(adapter)) {
    lanes.push({
      lane: 'go',
      mechanisms: [
        mechanism('go_benchmark', goBenchmarks.length > 0, 'Go benchmark metrics'),
        mechanism('cpu_profile', profile.profile_files > 0, 'Go pprof CPU profile'),
        mechanism(
          'allocation_profile',
          profile.profile_files > 0,
          'Go pprof alloc_objects and alloc_space profiles'
        ),
        mechanism('http_flow', flowKinds.has('http_server'), 'validated local Go trace'),
        mechanism('database_flow', flowKinds.has('database'), 'validated local Go trace'),
      ],
    });
  }
  return {
    schema_version: DETECTOR_COVERAGE_MATRIX_SCHEMA_VERSION,
    adapter,
    lanes: lanes.map((lane) => ({
      ...lane,
      mechanisms: lane.mechanisms.toSorted((left, right) =>
        left.mechanism.localeCompare(right.mechanism)
      ),
    })),
  };
}

function originalSourceMechanism(sourceMap) {
  if (sourceMap?.verified_candidates > 0) {
    return mechanism(
      'browser_original_source',
      true,
      'content-identical inline browser source map'
    );
  }
  return sourceMap?.candidate_count > 0
    ? insufficient(
        'browser_original_source',
        'bounded browser source-map verification',
        'Browser CPU candidates existed, but none mapped to content-identical current source.'
      )
    : unavailable(
        'browser_original_source',
        'No repository browser CPU candidate was available for source-map verification.'
      );
}

function phaseMechanism(name, phase, provenance) {
  return phase?.event_count > 0
    ? mechanism(name, true, provenance)
    : unavailable(name, `${provenance} produced no evidence for this exact workload.`);
}

function mechanism(name, available, provenance) {
  return available
    ? { mechanism: name, status: 'ran', provenance, limitation: null }
    : unavailable(name, `${provenance} produced no evidence for this exact workload.`);
}

function unavailable(name, limitation) {
  return { mechanism: name, status: 'unavailable', provenance: null, limitation };
}

function insufficient(name, provenance, limitation) {
  return { mechanism: name, status: 'insufficient_evidence', provenance, limitation };
}
