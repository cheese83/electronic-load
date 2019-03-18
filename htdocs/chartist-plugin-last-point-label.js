(function () {
	'use strict';

	const options = {
		offset: { x: 0.0, y: -10.0 }
	};

	Chartist.plugins = Chartist.plugins || {};
	Chartist.plugins.ctLastPointLabel = function() {
		return function ctLastPointLabel(chart) {
			if (chart instanceof Chartist.Line) {
				chart.on('draw', function(data) {
					if (data.type === 'line' && data.path.pathElements.length) {
						const lastIndex = data.path.pathElements.length - 1,
							lastPathElement = data.path.pathElements[lastIndex],
							y = lastPathElement.data.value.y,
							formattedValue = y < 1.0 ? y.toFixed(3) : y < 10 ? y.toFixed(2) : y.toFixed(1);

						data.group.elem('text', {
							x: lastPathElement.x + options.offset.x,
							y: lastPathElement.y + options.offset.y,
							style: 'text-anchor: middle'
						}, 'ct-point-label').text(formattedValue);
					}
				});
			}
		};
	};
})();
