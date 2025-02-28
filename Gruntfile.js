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
    }
  })

  // Load tasks
  grunt.loadNpmTasks('grunt-mocha-test')

  // Register combined task
  grunt.registerTask('mocha-and-karma', ['mochaTest'])
} 