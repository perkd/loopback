module.exports = function(grunt) {
  // Existing grunt configuration
  grunt.initConfig({
    mochaTest: {
      test: {
        options: {
          reporter: 'spec',
          timeout: 10000
        },
        src: ['test/**/*.js']
      }
    },
    karma: {
      unit: {
        configFile: 'karma.conf.js',
        autoWatch: false,
        singleRun: true
      }
    }
  })

  // Load tasks
  grunt.loadNpmTasks('grunt-mocha-test')
  grunt.loadNpmTasks('grunt-karma')

  // Register combined task
  grunt.registerTask('mocha-and-karma', ['mochaTest', 'karma'])
} 