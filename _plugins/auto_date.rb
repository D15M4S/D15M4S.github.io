module Jekyll
  class PostDateGenerator < Generator
    def generate(site)
      site.posts.docs.each do |post|
        if !post.data['date']
          post.data['date'] = Time.now
        end
      end
    end
  end
end