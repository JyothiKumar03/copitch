import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.apache.poi.hslf.usermodel.HSLFSlideShow;
import org.apache.poi.hslf.usermodel.HSLFTextParagraph;

public final class SlideText {
    public static void main(String[] args) throws Exception {
        int slideLimit = Integer.parseInt(args[0]);
        int textLimit = Integer.parseInt(args[1]);
        int characters = 0;
        try (var show = new HSLFSlideShow(System.in)) {
            var slides = show.getSlides();
            if (slides.size() > slideLimit) throw new IllegalArgumentException("Slide limit exceeded");
            for (var slide : slides) {
                var text = new StringBuilder();
                for (var paragraphs : slide.getTextParagraphs()) {
                    String block = HSLFTextParagraph.getText(paragraphs);
                    characters += block.length() + 1;
                    if (characters > textLimit) throw new IllegalArgumentException("Text limit exceeded");
                    text.append(block).append(' ');
                }
                System.out.println("SLIDE\t" + Base64.getEncoder().encodeToString(
                    text.toString().getBytes(StandardCharsets.UTF_8)));
            }
        }
    }
}
